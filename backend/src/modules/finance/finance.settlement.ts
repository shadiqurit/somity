import { Prisma, type MemberSettlement } from '@prisma/client';
import { AppError } from '../../utils/errors.js';

type Tx = Prisma.TransactionClient;
type Due = { loanId: string | null; loanNumber: string | null; due: string };
const zero = () => new Prisma.Decimal(0);

export function postedMemberEntries(societyId: string, memberId: string, kind: 'MEMBER_SAVINGS' | 'LOAN_RECEIVABLE') {
  return { societyId, memberId, account: { kind }, transaction: { status: 'POSTED' as const } };
}

export async function memberLedgerBalance(tx: Tx, societyId: string, memberId: string, kind: 'MEMBER_SAVINGS' | 'LOAN_RECEIVABLE') {
  const { _sum } = await tx.ledgerEntry.aggregate({
    where: postedMemberEntries(societyId, memberId, kind),
    _sum: { debit: true, credit: true },
  });
  const debit = _sum.debit ?? zero();
  const credit = _sum.credit ?? zero();
  return kind === 'MEMBER_SAVINGS' ? credit.minus(debit) : debit.minus(credit);
}

export function pendingMemberTransactions(tx: Tx, societyId: string, memberId: string) {
  return tx.financialTransaction.count({ where: { societyId, memberId, status: 'PENDING' } });
}

export async function memberDues(tx: Tx, societyId: string, memberId: string): Promise<Due[]> {
  const [savings, loans] = await Promise.all([
    memberLedgerBalance(tx, societyId, memberId, 'MEMBER_SAVINGS'),
    tx.$queryRaw<{ loanId: string; loanNumber: string; balance: Prisma.Decimal }[]>`
      SELECT l.id AS loanId, d.transactionNo AS loanNumber, SUM(e.debit - e.credit) AS balance
      FROM transaction_entries e
      JOIN accounts a ON a.societyId = e.societyId AND a.id = e.accountId AND a.kind = 'LOAN_RECEIVABLE'
      JOIN transactions t ON t.societyId = e.societyId AND t.id = e.transactionId AND t.status = 'POSTED'
      JOIN loans l ON l.societyId = t.societyId AND l.id = t.loanId AND l.memberId = e.memberId
      JOIN transactions d ON d.societyId = l.societyId AND d.id = l.disbursementId
      WHERE e.societyId = ${societyId} AND e.memberId = ${memberId}
      GROUP BY l.id, d.transactionNo
      HAVING SUM(e.debit - e.credit) <> 0
      ORDER BY d.transactionNo
    `,
  ]);
  if (savings.lt(0) || loans.some(loan => loan.balance.lt(0))) {
    throw new AppError(409, 'Correct the negative member balance before starting settlement');
  }
  return [
    ...(savings.isZero() ? [] : [{ loanId: null, loanNumber: null, due: savings.toFixed(2) }]),
    ...loans.map(({ loanId, loanNumber, balance }) => ({ loanId, loanNumber, due: balance.toFixed(2) })),
  ];
}

export function findSettlement(tx: Tx, societyId: string, memberId: string) {
  return tx.memberSettlement.findUnique({ where: { societyId_memberId_isCurrent: { societyId, memberId, isCurrent: true } } });
}

const paymentFields = {
  id: true, transactionNo: true, type: true, status: true, amount: true, loanId: true, effectiveDate: true,
  reference: true, note: true, reversalOf: { select: { transactionNo: true } }, cashAccount: { select: { name: true } },
} satisfies Prisma.FinancialTransactionSelect;

type SettlementPayment = Prisma.FinancialTransactionGetPayload<{ select: typeof paymentFields }>;

function settlementLines(dues: Due[], payments: SettlementPayment[]) {
  const totals = new Map<string | null, { paid: Prisma.Decimal; pending: Prisma.Decimal }>();
  for (const payment of payments) {
    const amounts = totals.get(payment.loanId) ?? { paid: zero(), pending: zero() };
    if (payment.status === 'POSTED') {
      amounts.paid = payment.type === 'REVERSAL' ? amounts.paid.minus(payment.amount) : amounts.paid.plus(payment.amount);
    }
    if (payment.status === 'PENDING' && payment.type !== 'REVERSAL') amounts.pending = amounts.pending.plus(payment.amount);
    totals.set(payment.loanId, amounts);
  }
  return dues.map(due => {
    const { paid, pending } = totals.get(due.loanId) ?? { paid: zero(), pending: zero() };
    const remaining = new Prisma.Decimal(due.due).minus(paid);
    return {
      ...due, paid: paid.toFixed(2), pending: pending.toFixed(2), remaining: remaining.toFixed(2),
      available: remaining.minus(pending).toFixed(2),
    };
  });
}

async function settlementPayments(tx: Tx, settlement: MemberSettlement) {
  const { id: settlementId, societyId, memberId } = settlement;
  return tx.financialTransaction.findMany({
    where: { settlementId, societyId, memberId },
    select: paymentFields,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
}

export async function describeSettlement(tx: Tx, societyId: string, memberId: string) {
  const member = await tx.member.findUnique({
    where: { societyId_id: { societyId, id: memberId } },
    select: { status: true },
  });
  if (!member) throw new AppError(404, 'Member not found');
  const settlement = await findSettlement(tx, societyId, memberId);
  const [dues, payments, pendingTransactions] = await Promise.all([
    settlement ? settlement.dues as Due[] : memberDues(tx, societyId, memberId),
    settlement ? settlementPayments(tx, settlement) : [],
    pendingMemberTransactions(tx, societyId, memberId),
  ]);
  const lines = settlementLines(dues, payments);
  return {
    id: settlement?.id ?? null,
    status: member.status === 'CLOSED' ? 'CLOSED' : settlement ? 'OPEN' : 'NOT_STARTED',
    openedAt: settlement?.openedAt ?? null,
    closedAt: settlement?.closedAt ?? null,
    pendingTransactions,
    lines,
    payments: payments.map(payment => ({ ...payment, amount: payment.amount.toFixed(2) })),
  };
}

export async function assertSettlementPayment(tx: Tx, settlement: MemberSettlement, loanId: string | null, amount: string) {
  const payments = await settlementPayments(tx, settlement);
  const line = settlementLines(settlement.dues as Due[], payments).find(line => line.loanId === loanId);
  if (!line) throw new AppError(422, 'Choose an item with a balance in this settlement');
  if (new Prisma.Decimal(amount).gt(line.available)) {
    throw new AppError(409, `Payment exceeds the unallocated amount (${line.available} BDT)`);
  }
}
