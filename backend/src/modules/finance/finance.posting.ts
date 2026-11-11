import { Prisma, type FinancialTransaction, type AccountKind } from '@prisma/client';
import { AppError } from '../../utils/errors.js';
type Tx = Prisma.TransactionClient;
export interface ProductDetails { installmentCount?: number; firstDueDate?: string; title?: string; counterparty?: string; principalReturned?: string; profit?: string; category?: string; payee?: string; destinationAccountId?: string; }
export interface PostingLine { line: number; accountId: string; debit: Prisma.Decimal; credit: Prisma.Decimal; }
const zero = () => new Prisma.Decimal(0);
const systemAccounts = {
  MEMBER_SAVINGS: ['MEMBER-SAVINGS', 'Member savings'], LOAN_RECEIVABLE: ['SYS-LOANS', 'Member loans receivable'],
  INVESTMENT_ASSET: ['SYS-INVESTMENTS', 'Investments'], INVESTMENT_INCOME: ['SYS-PROFIT', 'Investment profit'], EXPENSE: ['SYS-EXPENSE', 'Society expenses'],
} as const;
export async function systemAccount(tx: Tx, societyId: string, kind: keyof typeof systemAccounts) {
  const [code, name] = systemAccounts[kind];
  const account = await tx.ledgerAccount.upsert({ where: { societyId_code: { societyId, code } }, update: {}, create: { societyId, code, name, kind } });
  if (account.kind !== kind) throw new AppError(409, `Reserved system account ${code} has an incorrect kind`);
  return account;
}
export function principalSchedule(principal: string, count: number, firstDueDate: string) {
  if (!Number.isInteger(count) || count < 1 || count > 600) throw new AppError(422, 'Invalid installment count');
  const total = BigInt(new Prisma.Decimal(principal).times(100).toFixed(0));
  if (total < BigInt(count)) throw new AppError(422, 'Each installment must be at least BDT 0.01');
  const each = total / BigInt(count); const remainder = total % BigInt(count);
  const start = new Date(firstDueDate + 'T00:00:00Z');
  return Array.from({ length: count }, (_, index) => {
    const month = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1));
    const lastDay = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
    month.setUTCDate(Math.min(start.getUTCDate(), lastDay));
    const cents = each + (index === count - 1 ? remainder : 0n);
    return { number: index + 1, dueDate: month.toISOString().slice(0, 10), amount: new Prisma.Decimal(cents.toString()).div(100).toFixed(2) };
  });
}
export async function productLines(tx: Tx, item: FinancialTransaction) {
  const details = (item.details ?? {}) as ProductDetails;
  const lines: PostingLine[] = [];
  const add = (accountId: string, debit: Prisma.Decimal, credit: Prisma.Decimal) => { if (!debit.isZero() || !credit.isZero()) lines.push({ line: lines.length + 1, accountId, debit, credit }); };
  const system = async (kind: keyof typeof systemAccounts) => (await systemAccount(tx, item.societyId, kind)).id;
  const out = (id: string) => add(id, zero(), item.amount); const incoming = (id: string) => add(id, item.amount, zero());
  if (item.type === 'REVERSAL') {
    const original = await tx.financialTransaction.findUniqueOrThrow({ where: { societyId_id: { societyId: item.societyId, id: item.reversalOfId! } }, include: { entries: { orderBy: { line: 'asc' } } } });
    if (original.status !== 'POSTED' || original.type === 'REVERSAL' || !original.entries.length) throw new AppError(409, 'Original transaction cannot be reversed');
    if (await tx.financialTransaction.findFirst({ where: { societyId: item.societyId, reversalOfId: original.id, status: 'POSTED' } })) throw new AppError(409, 'Original transaction is already reversed');
    for (const line of original.entries) add(line.accountId, line.credit, line.debit);
  } else if (item.type === 'DEPOSIT') { incoming(item.cashAccountId); out(await system('MEMBER_SAVINGS')); }
  else if (item.type === 'WITHDRAWAL') { incoming(await system('MEMBER_SAVINGS')); out(item.cashAccountId); }
  else if (item.type === 'LOAN_DISBURSEMENT') {
    principalSchedule(item.amount.toFixed(2), details.installmentCount!, details.firstDueDate!);
    const loan = await tx.loan.create({ data: { societyId: item.societyId, memberId: item.memberId!, disbursementId: item.id, principal: item.amount, installmentCount: details.installmentCount!, firstDueDate: new Date(details.firstDueDate!) } });
    await tx.financialTransaction.update({ where: { id: item.id }, data: { loanId: loan.id } });
    incoming(await system('LOAN_RECEIVABLE')); out(item.cashAccountId);
  } else if (item.type === 'LOAN_REPAYMENT') { incoming(item.cashAccountId); out(await system('LOAN_RECEIVABLE')); }
  else if (item.type === 'INVESTMENT_PURCHASE') {
    const investment = await tx.investment.create({ data: { societyId: item.societyId, purchaseId: item.id, principal: item.amount, title: details.title!, counterparty: details.counterparty! } });
    await tx.financialTransaction.update({ where: { id: item.id }, data: { investmentId: investment.id } });
    incoming(await system('INVESTMENT_ASSET')); out(item.cashAccountId);
  } else if (item.type === 'INVESTMENT_RETURN') {
    const principal = new Prisma.Decimal(details.principalReturned!); const profit = new Prisma.Decimal(details.profit!);
    if (!principal.plus(profit).eq(item.amount)) throw new AppError(422, 'Return amount must equal principal returned plus profit');
    incoming(item.cashAccountId);
    add(await system('INVESTMENT_ASSET'), zero(), principal); add(await system('INVESTMENT_INCOME'), zero(), profit);
  } else if (item.type === 'EXPENSE') { incoming(await system('EXPENSE')); out(item.cashAccountId); }
  else if (item.type === 'TRANSFER') { incoming(details.destinationAccountId!); out(item.cashAccountId); }
  else throw new AppError(422, 'Unsupported transaction type');
  if (lines.length < 2 || !lines.reduce((sum, line) => sum.plus(line.debit).minus(line.credit), zero()).isZero()) throw new Error('Unbalanced posting');
  return lines;
}
export function isAsset(kind: AccountKind) { return ['CASH', 'BANK', 'LOAN_RECEIVABLE', 'INVESTMENT_ASSET'].includes(kind); }
