import { Prisma, type AccountKind, type FinancialTransactionType } from '@prisma/client';
import { db } from '../../config/database.js';
import { AppError } from '../../utils/errors.js';
import { principalSchedule, type ProductDetails } from './finance.posting.js';
import { todayDhaka, type FinanceListInput, type reportKindSchema, type reportQuerySchema } from './finance.validator.js';
type Tx = Prisma.TransactionClient;
const zero = () => new Prisma.Decimal(0);
const range = (input: { from?: string; to?: string }) => ({ ...(input.from ? { gte: new Date(input.from) } : {}), ...(input.to ? { lte: new Date(input.to) } : {}) });
const movements = (type: FinancialTransactionType): Prisma.FinancialTransactionWhereInput => ({
  OR: [{ type }, { type: 'REVERSAL', reversalOf: { type } }],
});
const creditPositive = (kind: AccountKind) => kind === 'INVESTMENT_INCOME' || kind === 'OTHER_INCOME' || kind === 'MEMBER_SAVINGS';
async function productBalance(tx: Tx, societyId: string, kind: AccountKind, scope: Prisma.FinancialTransactionWhereInput, memberId?: string) {
  const totals = await tx.ledgerEntry.aggregate({ where: { societyId, memberId, account: { kind }, transaction: { ...scope, status: 'POSTED' } }, _sum: { debit: true, credit: true } });
  const debit = totals._sum.debit ?? zero(); const credit = totals._sum.credit ?? zero();
  return creditPositive(kind) ? credit.minus(debit) : debit.minus(credit);
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
  const effectiveDate = range(input);
  const accountKinds = ['CASH', 'BANK'] as const;
  return db.$transaction(async tx => {
    const accounts = await tx.ledgerAccount.findMany({ where: { societyId, kind: { in: [...accountKinds] } }, orderBy: { code: 'asc' } });
    const items = await Promise.all(accounts.map(async account => {
      const base = { societyId, accountId: account.id };
      const before = await tx.ledgerEntry.aggregate({ where: { ...base, transaction: { status: 'POSTED', effectiveDate: { lt: new Date(input.from ?? '1000-01-01') } } }, _sum: { debit: true, credit: true } });
      const totals = await tx.ledgerEntry.aggregate({ where: { ...base, transaction: { status: 'POSTED', effectiveDate } }, _sum: { debit: true, credit: true } });
      const opening = (before._sum.debit ?? zero()).minus(before._sum.credit ?? zero()); const incoming = totals._sum.debit ?? zero(); const outgoing = totals._sum.credit ?? zero();
      return { ...account, opening: opening.toFixed(2), deposits: incoming.toFixed(2), withdrawals: outgoing.toFixed(2), closing: opening.plus(incoming).minus(outgoing).toFixed(2) };
    }));
    const [expenses, flows] = await Promise.all([
      expenseLedgerTotals(tx, societyId, effectiveDate),
      tx.ledgerEntry.aggregate({
        where: { societyId, account: { kind: { in: [...accountKinds] } }, transaction: { status: 'POSTED', effectiveDate, NOT: movements('TRANSFER') } },
        _sum: { debit: true, credit: true },
      }),
    ]);
    const opening = items.reduce((total, account) => total.plus(account.opening), zero());
    const closing = items.reduce((total, account) => total.plus(account.closing), zero());
    return {
      items,
      expenses: (expenses._sum.debit ?? zero()).minus(expenses._sum.credit ?? zero()).toFixed(2),
      summary: {
        opening: opening.toFixed(2),
        incoming: (flows._sum.debit ?? zero()).toFixed(2),
        outgoing: (flows._sum.credit ?? zero()).toFixed(2),
        closing: closing.toFixed(2),
      },
    };
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

const reportAccounts = {
  loans: ['LOAN_RECEIVABLE'],
  investments: ['INVESTMENT_ASSET', 'INVESTMENT_INCOME'],
  income: ['OTHER_INCOME', 'INVESTMENT_INCOME'],
  expenses: ['EXPENSE'],
  savings: ['MEMBER_SAVINGS'],
  'member-statement': ['MEMBER_SAVINGS', 'LOAN_RECEIVABLE'],
} as const;
const reportMemberSelect = { id: true, fullName: true, memberNo: true } as const;

export async function reportMembers(societyId: string, search: string) {
  if (search.length > 0 && search.length <= 32) {
    const exact = await db.member.findUnique({ where: { societyId_memberNo: { societyId, memberNo: search } }, select: reportMemberSelect });
    if (exact) return { items: [exact], hasMore: false };
  }
  const limit = 25;
  const matches = await db.member.findMany({
    where: { societyId, ...(search ? { OR: [{ fullName: { contains: search } }, { memberNo: { contains: search } }] } : {}) },
    select: reportMemberSelect,
    orderBy: [{ fullName: 'asc' }, { memberNo: 'asc' }, { id: 'asc' }],
    take: limit + 1,
  });
  return { items: matches.slice(0, limit), hasMore: matches.length > limit };
}

const transactionLabels: Record<FinancialTransactionType, string> = {
  DEPOSIT: 'Savings deposit', WITHDRAWAL: 'Savings withdrawal',
  LOAN_DISBURSEMENT: 'Loan disbursement', LOAN_REPAYMENT: 'Loan repayment',
  INVESTMENT_PURCHASE: 'Investment purchase', INVESTMENT_RETURN: 'Investment return',
  EXPENSE: 'Expense', OTHER_INCOME: 'Other income', TRANSFER: 'Transfer', REVERSAL: 'Reversal',
};

async function reportTotals(tx: Tx, societyId: string, kind: keyof typeof reportAccounts, input: { from?: string; to?: string; memberId?: string }) {
  const effectiveDate = range(input);
  const balance = (account: AccountKind, scope: Prisma.FinancialTransactionWhereInput = {}) =>
    productBalance(tx, societyId, account, { effectiveDate, ...scope }, input.memberId);
  const openingBalance = (account: AccountKind) => input.from
    ? balance(account, { effectiveDate: { lt: new Date(input.from) } })
    : Promise.resolve(zero());
  if (kind === 'income') {
    const otherIncome = await balance('OTHER_INCOME');
    const profit = await balance('INVESTMENT_INCOME');
    return { 'Other income': otherIncome, 'Investment profit': profit, 'Total income': otherIncome.plus(profit) };
  }
  if (kind === 'expenses') {
    const { _sum } = await expenseLedgerTotals(tx, societyId, effectiveDate);
    const gross = _sum.debit ?? zero();
    const reversals = _sum.credit ?? zero();
    return { 'Gross expenses': gross, 'Expense reversals': reversals, 'Net expenses': gross.minus(reversals) };
  }
  if (kind === 'member-statement') {
    const openingSavings = await openingBalance('MEMBER_SAVINGS');
    const openingLoans = await openingBalance('LOAN_RECEIVABLE');
    const closingSavings = openingSavings.plus(await balance('MEMBER_SAVINGS'));
    const closingLoans = openingLoans.plus(await balance('LOAN_RECEIVABLE'));
    return { 'Opening savings': openingSavings, 'Closing savings': closingSavings, 'Opening loan balance': openingLoans, 'Closing loan balance': closingLoans };
  }
  const [account] = reportAccounts[kind];
  const opening = await openingBalance(account);
  const change = await balance(account);
  const closing = opening.plus(change);
  if (kind === 'loans') {
    const disbursed = await balance(account, movements('LOAN_DISBURSEMENT'));
    return { 'Opening receivables': opening, 'Net disbursed': disbursed, 'Net repaid': disbursed.minus(change), 'Closing receivables': closing };
  }
  if (kind === 'investments') {
    const profit = await balance('INVESTMENT_INCOME');
    return { 'Opening principal': opening, 'Net principal movement': change, 'Closing principal': closing, 'Investment profit': profit };
  }
  return { 'Opening savings': opening, 'Net savings movement': change, 'Closing savings': closing };
}

export async function financialReport(societyId: string, kind: ReturnType<typeof reportKindSchema.parse>, input: ReturnType<typeof reportQuerySchema.parse>) {
  const { memberId } = input;
  if (kind === 'member-statement' && !memberId) throw new AppError(422, 'Choose a member for the statement');
  if (memberId && kind !== 'member-statement' && kind !== 'loans' && kind !== 'savings') {
    throw new AppError(422, 'Member filters are available for loans, savings and member statements');
  }
  if (kind === 'bank') {
    const { items, summary } = await bankSummary(societyId, input);
    return {
      items: items.map(({ id, name, code, kind, opening, deposits, withdrawals, closing }) => ({ id, name, code, kind, opening, deposits, withdrawals, closing })),
      summary: [
        { label: 'Opening balance', amount: summary.opening }, { label: 'Money in', amount: summary.incoming },
        { label: 'Money out', amount: summary.outgoing }, { label: 'Closing balance', amount: summary.closing },
      ],
      total: items.length, page: 1, pages: 1,
    };
  }

  const pageSize = 25;
  const where: Prisma.LedgerEntryWhereInput = {
    societyId, memberId, account: { kind: { in: [...reportAccounts[kind]] } },
    transaction: { status: 'POSTED', effectiveDate: range(input) },
  };
  return db.$transaction(async tx => {
    const reportMember = memberId ? await tx.member.findUnique({
      where: { societyId_id: { societyId, id: memberId } }, select: reportMemberSelect,
    }) : null;
    if (memberId && !reportMember) throw new AppError(404, 'Member not found');
    const totals = await reportTotals(tx, societyId, kind, input);
    const rows = await tx.ledgerEntry.findMany({
      where,
      orderBy: [{ transaction: { effectiveDate: 'desc' } }, { transaction: { postedAt: 'desc' } }, { transactionId: 'asc' }, { line: 'asc' }],
      ...(input.scope === 'preview' ? { skip: (input.page - 1) * pageSize, take: pageSize } : {}),
      select: {
        id: true, debit: true, credit: true, account: { select: { kind: true } },
        member: { select: { fullName: true, memberNo: true } },
        transaction: { select: {
          effectiveDate: true, transactionNo: true, type: true, note: true, reference: true, details: true,
          investment: { select: { title: true } }, reversalOf: { select: { type: true, transactionNo: true } },
        } },
      },
    });
    const total = input.scope === 'full' ? rows.length : await tx.ledgerEntry.count({ where });
    const items = rows.map(({ id, debit, credit, account, member, transaction }) => {
      const { reversalOf, type } = transaction;
      const movement = reversalOf ? `Reversal · ${transactionLabels[reversalOf.type]}` : transactionLabels[type];
      const subject = member && !reportMember ? `${member.memberNo} · ${member.fullName}` : transaction.investment?.title;
      const base = account.kind === 'INVESTMENT_ASSET' ? 'Principal' : account.kind === 'INVESTMENT_INCOME' ? 'Profit' : '';
      const expense = kind === 'expenses' ? transaction.details as ProductDetails | null : null;
      return {
        id, date: transaction.effectiveDate.toISOString().slice(0, 10), transactionNo: transaction.transactionNo,
        movement: [movement, kind === 'investments' ? base : ''].filter(Boolean).join(' · '),
        details: [subject, expense?.category, expense?.payee, reversalOf?.transactionNo ?? transaction.reference, transaction.note].filter(Boolean).join(' · '),
        amount: (creditPositive(account.kind) ? credit.minus(debit) : debit.minus(credit)).toFixed(2),
      };
    });
    const summary = Object.entries(totals).map(([label, amount]) => ({ label, amount: amount.toFixed(2) }));
    return { member: reportMember, items, summary, total, page: input.scope === 'full' ? 1 : input.page, pages: input.scope === 'full' ? 1 : Math.ceil(total / pageSize) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
