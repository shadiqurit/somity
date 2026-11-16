import { Prisma, type FinancialTransactionType } from '@prisma/client';
import { db } from '../../config/database.js';
import { AppError } from '../../utils/errors.js';
import { principalSchedule } from './finance.posting.js';
import { todayDhaka, type FinanceListInput } from './finance.validator.js';
type Tx = Prisma.TransactionClient;
const zero = () => new Prisma.Decimal(0);
const range = (input: { from?: string; to?: string }) => ({ ...(input.from ? { gte: new Date(input.from) } : {}), ...(input.to ? { lte: new Date(input.to) } : {}) });
const movements = (type: FinancialTransactionType): Prisma.FinancialTransactionWhereInput => ({
  OR: [{ type }, { type: 'REVERSAL', reversalOf: { type } }],
});
async function productBalance(tx: Tx, societyId: string, kind: 'LOAN_RECEIVABLE' | 'INVESTMENT_ASSET' | 'INVESTMENT_INCOME' | 'OTHER_INCOME', scope: Prisma.FinancialTransactionWhereInput) {
  const totals = await tx.ledgerEntry.aggregate({ where: { societyId, account: { kind }, transaction: { ...scope, status: 'POSTED' } }, _sum: { debit: true, credit: true } });
  const debit = totals._sum.debit ?? zero(); const credit = totals._sum.credit ?? zero();
  return kind === 'INVESTMENT_INCOME' || kind === 'OTHER_INCOME' ? credit.minus(debit) : debit.minus(credit);
}
export async function loans(societyId: string, input: FinanceListInput, ownMemberId?: string, detailId?: string) {
  return db.$transaction(async tx => {
    const where = { societyId, ...(ownMemberId || input.memberId ? { memberId: ownMemberId ?? input.memberId } : {}), ...(detailId ? { id: detailId } : {}) };
    const total = await tx.loan.count({ where });
    const rows = await tx.loan.findMany({ where, skip: detailId ? 0 : (input.page - 1) * input.pageSize, take: detailId ? 1 : input.pageSize, orderBy: { id: 'desc' }, include: { member: { select: { fullName: true, memberNo: true } }, disbursement: { select: { effectiveDate: true, transactionNo: true, reversals: { where: { status: 'POSTED' }, select: { id: true } } } } } });
    if (detailId && !rows.length) throw new AppError(404, 'Loan not found');
    const items = await Promise.all(rows.map(async loan => {
      const outstanding = await productBalance(tx, societyId, 'LOAN_RECEIVABLE', { loanId: loan.id });
      const cancelled = loan.disbursement.reversals.length > 0;
      const repaid = cancelled ? zero() : loan.principal.minus(outstanding);
      let remainingPaid = repaid;
      const schedule = principalSchedule(loan.principal.toFixed(2), loan.installmentCount, loan.firstDueDate.toISOString().slice(0, 10)).map(row => {
        const due = new Prisma.Decimal(row.amount); const allocated = Prisma.Decimal.min(remainingPaid, due); remainingPaid = remainingPaid.minus(allocated);
        const unpaid = due.minus(allocated);
        return { ...row, paid: allocated.toFixed(2), outstanding: cancelled ? '0.00' : unpaid.toFixed(2), status: cancelled ? 'CANCELLED' : unpaid.isZero() ? 'PAID' : row.dueDate < todayDhaka() ? 'OVERDUE' : 'DUE' };
      });
      const history = detailId ? await tx.financialTransaction.findMany({ where: { societyId, loanId: loan.id, status: 'POSTED' }, orderBy: [{ effectiveDate: 'asc' }, { postedAt: 'asc' }, { id: 'asc' }], select: { id: true, type: true, transactionNo: true, effectiveDate: true, amount: true, reversalOfId: true } }) : undefined;
      return { ...loan, principal: loan.principal.toFixed(2), repaid: repaid.toFixed(2), outstanding: outstanding.toFixed(2), installmentAmount: schedule[0]!.amount, nextDueDate: schedule.find(row => row.status !== 'PAID' && row.status !== 'CANCELLED')?.dueDate ?? null, status: cancelled ? 'CANCELLED' : outstanding.isZero() ? 'SETTLED' : 'ACTIVE', ...(detailId ? { installments: schedule, history } : {}) };
    }));
    return detailId ? items[0]! : { items, total, page: input.page, pageSize: input.pageSize, pages: Math.ceil(total / input.pageSize) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function loanSummary(societyId: string) {
  return db.$transaction(async tx => {
    const [disbursed, repaymentBalance, pending] = await Promise.all([
      productBalance(tx, societyId, 'LOAN_RECEIVABLE', movements('LOAN_DISBURSEMENT')),
      productBalance(tx, societyId, 'LOAN_RECEIVABLE', movements('LOAN_REPAYMENT')),
      tx.financialTransaction.count({ where: {
        societyId, status: 'PENDING',
        OR: [{ type: { in: ['LOAN_DISBURSEMENT', 'LOAN_REPAYMENT'] } }, { type: 'REVERSAL', loanId: { not: null } }],
      } }),
    ]);
    const repaid = zero().minus(repaymentBalance);
    return {
      disbursed: disbursed.toFixed(2),
      repaid: repaid.toFixed(2),
      outstanding: disbursed.minus(repaid).toFixed(2),
      pending,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function investments(societyId: string, input: FinanceListInput, detailId?: string) {
  return db.$transaction(async tx => {
    const where = { societyId, ...(detailId ? { id: detailId } : {}) };
    const total = await tx.investment.count({ where });
    const rows = await tx.investment.findMany({ where, orderBy: { id: 'desc' }, skip: detailId ? 0 : (input.page - 1) * input.pageSize, take: detailId ? 1 : input.pageSize, include: { purchase: { select: { effectiveDate: true, transactionNo: true, reversals: { where: { status: 'POSTED' }, select: { id: true } } } } } });
    if (detailId && !rows.length) throw new AppError(404, 'Investment not found');
    const items = await Promise.all(rows.map(async investment => {
      const outstanding = await productBalance(tx, societyId, 'INVESTMENT_ASSET', { investmentId: investment.id });
      const profit = await productBalance(tx, societyId, 'INVESTMENT_INCOME', { investmentId: investment.id });
      const cancelled = investment.purchase.reversals.length > 0;
      const history = detailId ? await tx.financialTransaction.findMany({ where: { societyId, investmentId: investment.id, status: 'POSTED' }, orderBy: [{ effectiveDate: 'asc' }, { postedAt: 'asc' }, { id: 'asc' }], select: { id: true, type: true, transactionNo: true, effectiveDate: true, amount: true, details: true, reversalOfId: true } }) : undefined;
      return { ...investment, principal: investment.principal.toFixed(2), principalReturned: cancelled ? '0.00' : investment.principal.minus(outstanding).toFixed(2), outstanding: outstanding.toFixed(2), profit: profit.toFixed(2), status: cancelled ? 'CANCELLED' : outstanding.isZero() ? 'RETURNED' : 'ACTIVE', ...(detailId ? { history } : {}) };
    }));
    return detailId ? items[0]! : { items, total, page: input.page, pageSize: input.pageSize, pages: Math.ceil(total / input.pageSize) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function investmentSummary(societyId: string) {
  return db.$transaction(async tx => {
    const [invested, outstanding, profit] = await Promise.all([
      productBalance(tx, societyId, 'INVESTMENT_ASSET', movements('INVESTMENT_PURCHASE')),
      productBalance(tx, societyId, 'INVESTMENT_ASSET', {}),
      productBalance(tx, societyId, 'INVESTMENT_INCOME', {}),
    ]);
    return {
      invested: invested.toFixed(2),
      principalReturned: invested.minus(outstanding).toFixed(2),
      outstanding: outstanding.toFixed(2),
      profit: profit.toFixed(2),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

function expenseLedgerTotals(tx: Tx, societyId: string, effectiveDate: ReturnType<typeof range>) {
  return tx.ledgerEntry.aggregate({
    where: { societyId, account: { kind: 'EXPENSE' }, transaction: { status: 'POSTED', effectiveDate } },
    _sum: { debit: true, credit: true },
  });
}

export async function expenseSummary(societyId: string, input: { from?: string; to?: string }) {
  const effectiveDate = range(input);
  return db.$transaction(async tx => {
    const [totals, pending] = await Promise.all([
      expenseLedgerTotals(tx, societyId, effectiveDate),
      tx.financialTransaction.count({ where: {
        societyId, effectiveDate, status: 'PENDING',
        OR: [{ type: 'EXPENSE' }, { type: 'REVERSAL', reversalOf: { type: 'EXPENSE' } }],
      } }),
    ]);
    const gross = totals._sum.debit ?? zero();
    const reversals = totals._sum.credit ?? zero();
    return { gross: gross.toFixed(2), reversals: reversals.toFixed(2), net: gross.minus(reversals).toFixed(2), pending };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function bankSummary(societyId: string, input: { from?: string; to?: string }) {
  return db.$transaction(async tx => {
    const accounts = await tx.ledgerAccount.findMany({ where: { societyId, kind: { in: ['CASH', 'BANK'] } }, orderBy: { code: 'asc' } });
    const items = await Promise.all(accounts.map(async account => {
      const base = { societyId, accountId: account.id };
      const before = await tx.ledgerEntry.aggregate({ where: { ...base, transaction: { status: 'POSTED', effectiveDate: { lt: new Date(input.from ?? '1000-01-01') } } }, _sum: { debit: true, credit: true } });
      const totals = await tx.ledgerEntry.aggregate({ where: { ...base, transaction: { status: 'POSTED', effectiveDate: range(input) } }, _sum: { debit: true, credit: true } });
      const opening = (before._sum.debit ?? zero()).minus(before._sum.credit ?? zero()); const incoming = totals._sum.debit ?? zero(); const outgoing = totals._sum.credit ?? zero();
      return { ...account, opening: opening.toFixed(2), deposits: incoming.toFixed(2), withdrawals: outgoing.toFixed(2), closing: opening.plus(incoming).minus(outgoing).toFixed(2) };
    }));
    const expenses = await expenseLedgerTotals(tx, societyId, range(input));
    return { items, expenses: (expenses._sum.debit ?? zero()).minus(expenses._sum.credit ?? zero()).toFixed(2) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function incomeSummary(societyId: string, input: { from?: string; to?: string }) {
  return db.$transaction(async tx => {
    const scope = { effectiveDate: range(input) };
    const otherIncome = await productBalance(tx, societyId, 'OTHER_INCOME', scope);
    const investmentProfit = await productBalance(tx, societyId, 'INVESTMENT_INCOME', scope);
    return {
      otherIncome: otherIncome.toFixed(2),
      investmentProfit: investmentProfit.toFixed(2),
      total: otherIncome.plus(investmentProfit).toFixed(2),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
