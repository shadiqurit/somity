import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { db } from '../../config/database.js';
import { audit } from '../../services/audit.js';
import { AppError } from '../../utils/errors.js';
import { productLines, isAsset, principalSchedule } from './finance.posting.js';
import type { accountSchema, policySchema, reversalSchema, decisionSchema, TransactionInput, FinanceListInput } from './finance.validator.js';

// Match MySQL aggregate precision so large balances retain their cents.
Prisma.Decimal.set({ precision: 65 });
const zero = () => new Prisma.Decimal(0);
const money = (value: Prisma.Decimal | null | undefined) => (value ?? zero()).toFixed(2);
const detailInclude = {
  member: { select: { id: true, fullName: true, memberNo: true } },
  cashAccount: { select: { id: true, name: true, kind: true } },
  createdBy: { select: { id: true, name: true } },
  decisions: { orderBy: { step: 'asc' as const }, include: { approver: { select: { id: true, name: true } } } },
  reversalOf: { select: { id: true, transactionNo: true, type: true } },
  reversals: { where: { status: { in: ['PENDING', 'POSTED'] as ('PENDING' | 'POSTED')[] } }, select: { id: true, status: true } },
} satisfies Prisma.FinancialTransactionInclude;
type Tx = Prisma.TransactionClient;
type Range = { from?: string; to?: string };
function dateRange(input: Range) { return { ...(input.from ? { gte: new Date(input.from) } : {}), ...(input.to ? { lte: new Date(input.to) } : {}) }; }
function financialMutation<T>(societyId: string, action: (tx: Tx) => Promise<T>) {
  return db.$transaction(async tx => {
    // Serialize financial writes per society. This also prevents concurrent
    // approvals/withdrawals from spending the same balance or posting twice.
    const rows = await tx.$queryRaw<{ currency: string }[]>`SELECT currency FROM societies WHERE id = ${societyId} AND isActive = true FOR UPDATE`;
    if (!rows.length) throw new AppError(403, 'This society is not available');
    if (rows[0]!.currency !== 'BDT') throw new AppError(422, 'Phase 2 currently supports BDT societies only');
    return action(tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 });
}
export async function policy(societyId: string) {
  return (await db.financePolicy.findUnique({ where: { societyId } })) ?? { societyId, version: 0, requiredApprovals: 1, allowSelfApproval: false };
}
export async function updatePolicy(societyId: string, actorId: string, input: z.infer<typeof policySchema>) {
  return financialMutation(societyId, async tx => {
    const before = await tx.financePolicy.findUnique({ where: { societyId } });
    if ((before?.version ?? 0) !== input.version) throw new AppError(409, 'Approval policy changed. Reload and try again');
    const data = { requiredApprovals: input.requiredApprovals, allowSelfApproval: input.allowSelfApproval, version: input.version + 1 };
    const result = await tx.financePolicy.upsert({ where: { societyId }, create: { societyId, ...data }, update: data });
    await audit(tx, actorId, 'FINANCE_POLICY_UPDATED', 'finance_policy', societyId, data, societyId);
    return result;
  });
}
async function savingsAccount(tx: Tx, societyId: string) {
  return tx.ledgerAccount.upsert({ where: { societyId_code: { societyId, code: 'MEMBER-SAVINGS' } }, update: {}, create: { societyId, code: 'MEMBER-SAVINGS', name: 'Member savings', kind: 'MEMBER_SAVINGS' } });
}
export async function createAccount(societyId: string, actorId: string, input: z.infer<typeof accountSchema>) {
  return financialMutation(societyId, async tx => {
    if (await tx.ledgerAccount.findUnique({ where: { societyId_code: { societyId, code: input.code } } })) throw new AppError(409, 'Account code is already in use');
    await savingsAccount(tx, societyId);
    const account = await tx.ledgerAccount.create({ data: { societyId, ...input, bankName: input.kind === 'BANK' ? input.bankName : null, accountNumberLast4: input.kind === 'BANK' ? input.accountNumberLast4 || null : null } });
    await audit(tx, actorId, 'FINANCE_ACCOUNT_CREATED', 'account', account.id, { code: account.code, name: account.name, kind: account.kind }, societyId);
    return account;
  });
}
export async function accounts(societyId: string) {
  return db.$transaction(async tx => {
    const items = await tx.ledgerAccount.findMany({ where: { societyId }, orderBy: { code: 'asc' } });
    return Promise.all(items.map(async account => {
      const totals = await tx.ledgerEntry.aggregate({ where: { societyId, accountId: account.id, transaction: { status: 'POSTED' } }, _sum: { debit: true, credit: true } });
      const debit = totals._sum.debit ?? zero(); const credit = totals._sum.credit ?? zero();
      return { ...account, balance: money(['MEMBER_SAVINGS', 'INVESTMENT_INCOME'].includes(account.kind) ? credit.minus(debit) : debit.minus(credit)) };
    }));
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
export async function list(societyId: string, input: FinanceListInput) {
  const where: Prisma.FinancialTransactionWhereInput = { societyId, ...(input.status ? { status: input.status } : {}), ...(input.type ? { type: input.type } : {}), ...(input.memberId ? { memberId: input.memberId } : {}), effectiveDate: dateRange(input) };
  const [items, total] = await db.$transaction([
    db.financialTransaction.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (input.page - 1) * input.pageSize, take: input.pageSize, include: detailInclude }),
    db.financialTransaction.count({ where }),
  ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  return { items: items.map(item => ({ ...item, amount: money(item.amount) })), total, page: input.page, pageSize: input.pageSize, pages: Math.ceil(total / input.pageSize) };
}
export async function get(societyId: string, id: string, tx: Tx = db) {
  const item = await tx.financialTransaction.findUnique({ where: { societyId_id: { societyId, id } }, include: { ...detailInclude, entries: { orderBy: { line: 'asc' }, include: { account: { select: { code: true, name: true } } } } } });
  if (!item) throw new AppError(404, 'Transaction not found');
  return { ...item, amount: money(item.amount) };
}
async function replay(tx: Tx, societyId: string, key: string, hash: string) {
  const item = await tx.financialTransaction.findUnique({ where: { societyId_idempotencyKey: { societyId, idempotencyKey: key } } });
  if (!item) return null;
  if (item.requestHash !== hash) throw new AppError(409, 'This submission key was used for a different request');
  return get(societyId, item.id, tx);
}
const requestHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function submit(societyId: string, actorId: string, input: TransactionInput, key: string) {
  const normalized = { ...input, amount: new Prisma.Decimal(input.amount).toFixed(2) };
  const hash = requestHash({ actorId, ...normalized });
  return financialMutation(societyId, async tx => {
    const prior = await replay(tx, societyId, key, hash); if (prior) return prior;
    let memberId = input.memberId;
    if (memberId && !await tx.member.findFirst({ where: { id: memberId, societyId, archivedAt: null, status: 'ACTIVE' } })) throw new AppError(404, 'Active member not found in this society');
    const account = await tx.ledgerAccount.findFirst({ where: { id: input.cashAccountId, societyId, isActive: true, kind: { in: ['CASH', 'BANK'] } } });
    if (!account) throw new AppError(404, 'Active cash or bank account not found in this society');
    if (input.loanId) {
      const loan = await tx.loan.findUnique({ where: { societyId_id: { societyId, id: input.loanId } }, include: { disbursement: true } });
      if (!loan) throw new AppError(404, 'Loan not found in this society');
      memberId = loan.memberId;
      await assertProductDate(tx, societyId, loan.disbursement, new Date(input.effectiveDate));
    }
    if (input.investmentId) {
      const investment = await tx.investment.findUnique({ where: { societyId_id: { societyId, id: input.investmentId } }, include: { purchase: true } });
      if (!investment) throw new AppError(404, 'Investment not found in this society');
      await assertProductDate(tx, societyId, investment.purchase, new Date(input.effectiveDate));
    }
    if (input.destinationAccountId && !await tx.ledgerAccount.findFirst({ where: { societyId, id: input.destinationAccountId, kind: { in: ['CASH', 'BANK'] }, isActive: true } })) throw new AppError(404, 'Destination account not found in this society');
    if (input.type === 'LOAN_DISBURSEMENT') principalSchedule(input.amount, input.installmentCount!, input.firstDueDate!);
    if (input.type === 'INVESTMENT_RETURN' && !new Prisma.Decimal(input.principalReturned!).plus(input.profit!).eq(input.amount)) throw new AppError(422, 'Return amount must equal principal returned plus profit');
    const details = Object.fromEntries(['installmentCount', 'firstDueDate', 'title', 'counterparty', 'principalReturned', 'profit', 'category', 'payee', 'destinationAccountId'].filter(key => normalized[key as keyof typeof normalized] != null).map(key => [key, normalized[key as keyof typeof normalized]])) as Prisma.InputJsonObject;
    const captured = await tx.financePolicy.findUnique({ where: { societyId } });
    const item = await tx.financialTransaction.create({ data: { societyId, type: input.type, memberId, cashAccountId: input.cashAccountId, amount: normalized.amount, effectiveDate: new Date(input.effectiveDate), reference: input.reference, note: input.note, loanId: input.loanId, investmentId: input.investmentId, details, createdById: actorId, idempotencyKey: key, requestHash: hash, transactionNo: 'TX-' + randomBytes(12).toString('hex').toUpperCase(), policyVersion: captured?.version ?? 0, requiredApprovals: captured?.requiredApprovals ?? 1, allowSelfApproval: captured?.allowSelfApproval ?? false } });
    await audit(tx, actorId, 'FINANCE_REQUESTED', 'transaction', item.id, { ...JSON.parse(JSON.stringify(normalized)), requiredApprovals: item.requiredApprovals, policyVersion: item.policyVersion }, societyId);
    return get(societyId, item.id, tx);
  });
}
async function assertProductDate(tx: Tx, societyId: string, original: { id: string; effectiveDate: Date; status: string }, date: Date) {
  if (original.status !== 'POSTED' || date < original.effectiveDate) throw new AppError(422, 'Date cannot precede the approved loan or investment');
  if (await tx.financialTransaction.findFirst({ where: { societyId, reversalOfId: original.id, status: 'POSTED' } })) throw new AppError(409, 'The loan or investment has been reversed');
}

export async function requestReversal(societyId: string, actorId: string, id: string, input: z.infer<typeof reversalSchema>, key: string) {
  const hash = requestHash({ actorId, reversalOfId: id, ...input });
  return financialMutation(societyId, async tx => {
    const prior = await replay(tx, societyId, key, hash); if (prior) return prior;
    const original = await tx.financialTransaction.findUnique({ where: { societyId_id: { societyId, id } } });
    if (!original) throw new AppError(404, 'Transaction not found');
    if (original.status !== 'POSTED' || original.type === 'REVERSAL') throw new AppError(409, 'Only an original posted transaction can be reversed');
    if (new Date(input.effectiveDate) < original.effectiveDate) throw new AppError(422, 'Reversal date cannot precede the original transaction');
    if (await tx.financialTransaction.findFirst({ where: { societyId, reversalOfId: id, status: { in: ['PENDING', 'POSTED'] } } })) throw new AppError(409, 'A reversal is already pending or posted');
    const captured = await tx.financePolicy.findUnique({ where: { societyId } });
    const item = await tx.financialTransaction.create({ data: { societyId, type: 'REVERSAL', memberId: original.memberId, loanId: original.loanId, investmentId: original.investmentId, details: original.details ?? Prisma.JsonNull, cashAccountId: original.cashAccountId, amount: original.amount, effectiveDate: new Date(input.effectiveDate), reference: original.transactionNo, note: input.note, createdById: actorId, idempotencyKey: key, requestHash: hash, transactionNo: `RV-${randomBytes(12).toString('hex').toUpperCase()}`, reversalOfId: id, policyVersion: captured?.version ?? 0, requiredApprovals: captured?.requiredApprovals ?? 1, allowSelfApproval: captured?.allowSelfApproval ?? false } });
    await audit(tx, actorId, 'FINANCE_REVERSAL_REQUESTED', 'transaction', item.id, { reversalOfId: id, ...input }, societyId);
    return get(societyId, item.id, tx);
  });
}

// Include historical dates when checking funds: a backdated withdrawal must not
// make a member or cash/bank account negative at any later date either.
async function assertFunds(tx: Tx, societyId: string, accountId: string, memberId: string | null, effectiveDate: Date, delta: Prisma.Decimal, liability: boolean, scope: Prisma.FinancialTransactionWhereInput = {}) {
  const where: Prisma.LedgerEntryWhereInput = { societyId, accountId, ...(memberId ? { memberId } : {}), transaction: { status: 'POSTED' } };
  const before = await tx.ledgerEntry.aggregate({ where: { ...where, transaction: { ...scope, status: 'POSTED', effectiveDate: { lt: effectiveDate } } }, _sum: { debit: true, credit: true } });
  let balance = liability ? (before._sum.credit ?? zero()).minus(before._sum.debit ?? zero()) : (before._sum.debit ?? zero()).minus(before._sum.credit ?? zero());
  const after = await tx.ledgerEntry.findMany({ where: { ...where, transaction: { ...scope, status: 'POSTED', effectiveDate: { gte: effectiveDate } } }, include: { transaction: { select: { effectiveDate: true } } } });
  const daily = new Map<string, Prisma.Decimal>([[effectiveDate.toISOString().slice(0, 10), delta]]);
  for (const entry of after) {
    const day = entry.transaction.effectiveDate.toISOString().slice(0, 10);
    daily.set(day, (daily.get(day) ?? zero()).plus(liability ? entry.credit.minus(entry.debit) : entry.debit.minus(entry.credit)));
  }
  for (const day of [...daily.keys()].sort()) {
    balance = balance.plus(daily.get(day)!);
    if (balance.lt(0)) throw new AppError(409, scope.loanId ? 'Repayment exceeds outstanding loan principal for this date' : scope.investmentId ? 'Return exceeds outstanding investment principal for this date' : memberId ? 'Insufficient member savings for this date and later transactions' : 'Insufficient funds in the selected cash or bank account');
  }
}
export function balancedLines(amount: Prisma.Decimal, cashAccountId: string, savingsAccountId: string, increasesSavings: boolean) {
  if (!amount.isFinite() || !amount.gt(0) || amount.decimalPlaces() > 2 || amount.gte('1000000000000000000')) throw new AppError(422, 'Invalid ledger amount');
  const lines = [
    { line: 1, accountId: cashAccountId, debit: increasesSavings ? amount : zero(), credit: increasesSavings ? zero() : amount },
    { line: 2, accountId: savingsAccountId, debit: increasesSavings ? zero() : amount, credit: increasesSavings ? amount : zero() },
  ];
  if (!lines.reduce((sum, line) => sum.plus(line.debit).minus(line.credit), zero()).isZero()) throw new Error('Unbalanced posting');
  return lines;
}
async function post(tx: Tx, societyId: string, id: string, actorId: string) {
  let item = await tx.financialTransaction.findUniqueOrThrow({ where: { societyId_id: { societyId, id } } });
  if (item.type !== 'REVERSAL' && item.memberId && item.type !== 'LOAN_REPAYMENT' && !await tx.member.findFirst({ where: { id: item.memberId, societyId, archivedAt: null, status: 'ACTIVE' } })) throw new AppError(409, 'Member is no longer active');
  if (item.type === 'LOAN_REPAYMENT') {
    const loan = await tx.loan.findUniqueOrThrow({ where: { societyId_id: { societyId, id: item.loanId! } }, include: { disbursement: true } });
    await assertProductDate(tx, societyId, loan.disbursement, item.effectiveDate);
  }
  if (item.type === 'INVESTMENT_RETURN') {
    const investment = await tx.investment.findUniqueOrThrow({ where: { societyId_id: { societyId, id: item.investmentId! } }, include: { purchase: true } });
    await assertProductDate(tx, societyId, investment.purchase, item.effectiveDate);
  }
  const entries = await productLines(tx, item);
  item = await tx.financialTransaction.findUniqueOrThrow({ where: { id } });
  for (const entry of entries) {
    const account = await tx.ledgerAccount.findUniqueOrThrow({ where: { societyId_id: { societyId, id: entry.accountId } } });
    if (!account.isActive) throw new AppError(409, 'Posting account is no longer active');
    const liability = account.kind === 'MEMBER_SAVINGS';
    if (liability || isAsset(account.kind)) {
      const scope = account.kind === 'LOAN_RECEIVABLE' ? { loanId: item.loanId } : account.kind === 'INVESTMENT_ASSET' ? { investmentId: item.investmentId } : {};
      const delta = liability ? entry.credit.minus(entry.debit) : entry.debit.minus(entry.credit);
      await assertFunds(tx, societyId, account.id, liability ? item.memberId : null, item.effectiveDate, delta, liability, scope);
    }
  }
  await tx.ledgerEntry.createMany({ data: entries.map(line => ({ ...line, societyId, transactionId: id, memberId: item.memberId })) });
  await tx.financialTransaction.update({ where: { societyId_id: { societyId, id } }, data: { status: 'POSTED', postedAt: new Date() } });
  await audit(tx, actorId, 'FINANCE_POSTED', 'transaction', id, { type: item.type, amount: money(item.amount), reversalOfId: item.reversalOfId }, societyId);
}

export async function decide(societyId: string, actorId: string, id: string, input: z.infer<typeof decisionSchema>) {
  return financialMutation(societyId, async tx => {
    const item = await tx.financialTransaction.findUnique({ where: { societyId_id: { societyId, id } }, include: { decisions: true } });
    if (!item) throw new AppError(404, 'Transaction not found');
    if (item.status !== 'PENDING') throw new AppError(409, 'This request has already been completed');
    if (!item.allowSelfApproval && item.createdById === actorId) throw new AppError(403, 'You cannot approve or reject your own request');
    if (item.decisions.some(d => d.approverId === actorId)) throw new AppError(409, 'You have already decided on this request');
    const step = item.decisions.length + 1;
    await tx.approvalDecision.create({ data: { societyId, transactionId: id, step, approverId: actorId, ...input } });
    await audit(tx, actorId, `FINANCE_${input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED'}`, 'transaction', id, { step, comment: input.comment }, societyId);
    if (input.decision === 'REJECT') await tx.financialTransaction.update({ where: { societyId_id: { societyId, id } }, data: { status: 'REJECTED' } });
    else if (step >= item.requiredApprovals) await post(tx, societyId, id, actorId);
    return get(societyId, id, tx);
  });
}
export async function cancel(societyId: string, actorId: string, id: string) {
  return financialMutation(societyId, async tx => {
    const item = await tx.financialTransaction.findUnique({ where: { societyId_id: { societyId, id } } });
    if (!item) throw new AppError(404, 'Transaction not found');
    if (item.createdById !== actorId) throw new AppError(403, 'Only the requester can cancel a pending request');
    if (item.status !== 'PENDING') throw new AppError(409, 'Only pending requests can be cancelled; posted transactions require a reversal');
    await tx.financialTransaction.update({ where: { societyId_id: { societyId, id } }, data: { status: 'CANCELLED' } });
    await audit(tx, actorId, 'FINANCE_CANCELLED', 'transaction', id, undefined, societyId);
    return get(societyId, id, tx);
  });
}
export async function statement(societyId: string, memberId: string, input: Range & { page: number; pageSize: number }) {
  return db.$transaction(async tx => {
    const member = await tx.member.findUnique({ where: { societyId_id: { societyId, id: memberId } }, select: { id: true, fullName: true, memberNo: true } });
    if (!member) throw new AppError(404, 'Member not found');
    const base: Prisma.LedgerEntryWhereInput = { societyId, memberId, account: { kind: 'MEMBER_SAVINGS' }, transaction: { status: 'POSTED' } };
    const openingTotals = await tx.ledgerEntry.aggregate({ where: { ...base, transaction: { status: 'POSTED', effectiveDate: { lt: new Date(input.from ?? '1000-01-01') } } }, _sum: { debit: true, credit: true } });
    const opening = (openingTotals._sum.credit ?? zero()).minus(openingTotals._sum.debit ?? zero());
    const where = { ...base, transaction: { status: 'POSTED' as const, effectiveDate: dateRange(input) } };
    // A bounded page is returned; earlier lines only supply that page's opening balance.
    const total = await tx.ledgerEntry.count({ where });
    const offset = (input.page - 1) * input.pageSize;
    const orderBy = [{ transaction: { effectiveDate: 'asc' as const } }, { transaction: { postedAt: 'asc' as const } }, { transactionId: 'asc' as const }];
    const prior = offset ? await tx.ledgerEntry.findMany({ where, orderBy, take: Math.min(offset, total), select: { credit: true, debit: true } }) : [];
    let running = prior.reduce((balance, line) => balance.plus(line.credit).minus(line.debit), opening);
    const rows = await tx.ledgerEntry.findMany({ where, orderBy, skip: offset, take: input.pageSize, include: { transaction: { select: { id: true, transactionNo: true, type: true, effectiveDate: true, reference: true, note: true, reversalOfId: true } } } });
    const totals = await tx.ledgerEntry.aggregate({ where, _sum: { debit: true, credit: true } });
    const deposits = totals._sum.credit ?? zero(); const withdrawals = totals._sum.debit ?? zero();
    return { member, currency: 'BDT', openingBalance: money(opening), closingBalance: money(opening.plus(deposits).minus(withdrawals)), deposits: money(deposits), withdrawals: money(withdrawals), items: rows.map(line => { running = running.plus(line.credit).minus(line.debit); return { ...line.transaction, id: line.id, transactionId: line.transaction.id, deposit: money(line.credit), withdrawal: money(line.debit), balance: money(running) }; }), total, page: input.page, pageSize: input.pageSize, pages: Math.ceil(total / input.pageSize) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
export async function summary(societyId: string, input: Range) {
  return db.$transaction(async tx => {
    const totals = await tx.ledgerEntry.aggregate({ where: { societyId, account: { kind: 'MEMBER_SAVINGS' }, transaction: { status: 'POSTED', effectiveDate: dateRange(input) } }, _sum: { debit: true, credit: true } });
    const savings = await tx.ledgerEntry.aggregate({ where: { societyId, account: { kind: 'MEMBER_SAVINGS' }, transaction: { status: 'POSTED', ...(input.to ? { effectiveDate: { lte: new Date(input.to) } } : {}) } }, _sum: { debit: true, credit: true } });
    const pending = await tx.financialTransaction.count({ where: { societyId, status: 'PENDING' } });
    return { deposits: money(totals._sum.credit), withdrawals: money(totals._sum.debit), memberSavings: money((savings._sum.credit ?? zero()).minus(savings._sum.debit ?? zero())), pending, currency: 'BDT' };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
export async function ledger(societyId: string, input: FinanceListInput) {
  const where: Prisma.LedgerEntryWhereInput = { societyId, ...(input.memberId ? { memberId: input.memberId } : {}), transaction: { status: 'POSTED', effectiveDate: dateRange(input) } };
  const [items, total] = await db.$transaction([
    db.ledgerEntry.findMany({ where, orderBy: [{ transaction: { effectiveDate: 'desc' } }, { transaction: { postedAt: 'desc' } }, { transactionId: 'asc' }, { line: 'asc' }], skip: (input.page - 1) * input.pageSize, take: input.pageSize, include: { account: { select: { code: true, name: true } }, member: { select: { fullName: true, memberNo: true } }, transaction: { select: { transactionNo: true, effectiveDate: true, type: true } } } }),
    db.ledgerEntry.count({ where }),
  ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  return { items, total, page: input.page, pageSize: input.pageSize, pages: Math.ceil(total / input.pageSize) };
}
