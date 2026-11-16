import { Prisma, type AccountKind } from '@prisma/client';
import { db } from '../../config/database.js';
import { AppError } from '../../utils/errors.js';
import { postedMemberEntries } from './finance.settlement.js';
import type { FinanceListInput } from './finance.validator.js';

type Tx = Prisma.TransactionClient;
type Query = Pick<FinanceListInput, 'from' | 'to' | 'page' | 'pageSize'>;
type BalanceKind = 'MEMBER_SAVINGS' | 'LOAN_RECEIVABLE';
const balanceKinds: BalanceKind[] = ['MEMBER_SAVINGS', 'LOAN_RECEIVABLE'];
const paymentKinds: AccountKind[] = ['CASH', 'BANK'];
const zero = () => new Prisma.Decimal(0);

async function totals(tx: Tx, societyId: string, memberId: string, transaction: Prisma.FinancialTransactionWhereInput) {
  async function accountTotals(kind: BalanceKind) {
    const base = postedMemberEntries(societyId, memberId, kind);
    const { _sum } = await tx.ledgerEntry.aggregate({
      where: { ...base, transaction: { ...transaction, ...base.transaction } },
      _sum: { debit: true, credit: true },
    });
    return { debit: _sum.debit ?? zero(), credit: _sum.credit ?? zero() };
  }
  const [savings, loans] = await Promise.all([accountTotals('MEMBER_SAVINGS'), accountTotals('LOAN_RECEIVABLE')]);
  return { savings, loans };
}

function movement(entries: { debit: Prisma.Decimal; credit: Prisma.Decimal; account: { kind: AccountKind } }[], ...kinds: AccountKind[]) {
  return entries.filter(entry => kinds.includes(entry.account.kind)).reduce((sum, entry) => ({
    debit: sum.debit.plus(entry.debit), credit: sum.credit.plus(entry.credit),
  }), { debit: zero(), credit: zero() });
}

export function memberDuesStatement(societyId: string, memberId: string, query: Query) {
  return db.$transaction(async tx => {
    const member = await tx.member.findUnique({
      where: { societyId_id: { societyId, id: memberId } }, select: { id: true },
    });
    if (!member) throw new AppError(404, 'Member not found');

    const { from, to, page, pageSize } = query;
    const fromDate = from ? new Date(from) : undefined;
    const effectiveDate = { gte: fromDate, lte: to ? new Date(to) : undefined };
    const entryScope = { societyId, memberId };
    const where: Prisma.FinancialTransactionWhereInput = {
      societyId, memberId, status: 'POSTED', effectiveDate,
      entries: { some: { ...entryScope, account: { kind: { in: balanceKinds } } } },
    };
    const [opening, period, total, rows] = await Promise.all([
      fromDate ? totals(tx, societyId, memberId, { effectiveDate: { lt: fromDate } }) : undefined,
      totals(tx, societyId, memberId, { effectiveDate }),
      tx.financialTransaction.count({ where }),
      tx.financialTransaction.findMany({
        where, orderBy: [{ effectiveDate: 'desc' }, { postedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize, take: pageSize,
        select: {
          id: true, transactionNo: true, type: true, effectiveDate: true, postedAt: true, reference: true, note: true,
          settlementId: true, cashAccount: { select: { name: true } },
          loan: { select: { disbursement: { select: { transactionNo: true } } } },
          reversalOf: { select: { transactionNo: true, type: true } },
          entries: {
            where: { ...entryScope, account: { kind: { in: [...balanceKinds, ...paymentKinds] } } },
            select: { debit: true, credit: true, account: { select: { kind: true } } },
          },
        },
      }),
    ]);
    const openingSavings = opening?.savings.credit.minus(opening.savings.debit) ?? zero();
    const openingLoans = opening?.loans.debit.minus(opening.loans.credit) ?? zero();
    const closingSavings = openingSavings.plus(period.savings.credit).minus(period.savings.debit);
    const closingLoans = openingLoans.plus(period.loans.debit).minus(period.loans.credit);
    let runningSavings = closingSavings;
    let runningLoans = closingLoans;

    // Take newer movements off the closing balances before walking an older page backwards.
    const first = rows[0];
    if (page > 1 && first) {
      const newer = await totals(tx, societyId, memberId, { effectiveDate, OR: [
        { effectiveDate: { gt: first.effectiveDate } },
        { effectiveDate: first.effectiveDate, postedAt: first.postedAt ? { gt: first.postedAt } : { not: null } },
        { effectiveDate: first.effectiveDate, postedAt: first.postedAt, id: { gt: first.id } },
      ] });
      runningSavings = runningSavings.minus(newer.savings.credit).plus(newer.savings.debit);
      runningLoans = runningLoans.minus(newer.loans.debit).plus(newer.loans.credit);
    }

    const items = rows.map(({ entries, loan, cashAccount, postedAt, settlementId, ...row }) => {
      const savings = movement(entries, 'MEMBER_SAVINGS');
      const loans = movement(entries, 'LOAN_RECEIVABLE');
      const payment = movement(entries, ...paymentKinds);
      const item = {
        ...row, accountName: cashAccount.name, loanNumber: loan?.disbursement.transactionNo ?? null, settlement: !!settlementId,
        paidByMember: payment.debit.toFixed(2), paidBySociety: payment.credit.toFixed(2),
        savingsAfter: runningSavings.toFixed(2), loanAfter: runningLoans.toFixed(2),
      };
      runningSavings = runningSavings.minus(savings.credit).plus(savings.debit);
      runningLoans = runningLoans.minus(loans.debit).plus(loans.credit);
      return item;
    });

    return {
      savings: { opening: openingSavings.toFixed(2), deposits: period.savings.credit.toFixed(2), withdrawals: period.savings.debit.toFixed(2), closing: closingSavings.toFixed(2) },
      loans: { opening: openingLoans.toFixed(2), disbursed: period.loans.debit.toFixed(2), repaid: period.loans.credit.toFixed(2), closing: closingLoans.toFixed(2) },
      items, total, page, pageSize, pages: Math.ceil(total / pageSize),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
