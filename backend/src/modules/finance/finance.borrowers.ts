import { Prisma } from '@prisma/client';
import { db } from '../../config/database.js';
import { audit } from '../../services/audit.js';
import { lockActiveSociety } from '../../services/tenant.js';
import { AppError } from '../../utils/errors.js';
import { principalSchedule } from './finance.posting.js';
import { todayDhaka, type BorrowerInput, type BorrowerListInput, type BorrowerUpdateInput } from './finance.validator.js';

Prisma.Decimal.set({ precision: 65 });
type Tx = Prisma.TransactionClient;
const zero = () => new Prisma.Decimal(0);

async function loanOutstanding(tx: Tx, societyId: string, loanId: string) {
  const { _sum } = await tx.ledgerEntry.aggregate({
    where: { societyId, account: { kind: 'LOAN_RECEIVABLE' }, transaction: { loanId, status: 'POSTED' } },
    _sum: { debit: true, credit: true },
  });
  return (_sum.debit ?? zero()).minus(_sum.credit ?? zero());
}

async function borrowerTotals(tx: Tx, societyId: string, borrowerId: string) {
  const [loans, disbursedAgg, repaidAgg, pendingCount] = await Promise.all([
    tx.loan.findMany({
      where: { societyId, borrowerId },
      select: { id: true, principal: true, disbursement: { select: { reversals: { where: { status: 'POSTED' }, select: { id: true } } } } },
    }),
    tx.ledgerEntry.aggregate({
      where: {
        societyId,
        account: { kind: 'LOAN_RECEIVABLE' },
        transaction: {
          borrowerId,
          status: 'POSTED',
          OR: [{ type: 'LOAN_DISBURSEMENT' }, { type: 'REVERSAL', reversalOf: { type: 'LOAN_DISBURSEMENT' } }],
        },
      },
      _sum: { debit: true, credit: true },
    }),
    tx.ledgerEntry.aggregate({
      where: {
        societyId,
        account: { kind: 'LOAN_RECEIVABLE' },
        transaction: {
          borrowerId,
          status: 'POSTED',
          OR: [{ type: 'LOAN_REPAYMENT' }, { type: 'REVERSAL', reversalOf: { type: 'LOAN_REPAYMENT' } }],
        },
      },
      _sum: { debit: true, credit: true },
    }),
    tx.financialTransaction.count({ where: { societyId, borrowerId, status: 'PENDING', deletedAt: null } }),
  ]);
  const disbursed = (disbursedAgg._sum.debit ?? zero()).minus(disbursedAgg._sum.credit ?? zero());
  const repaid = (repaidAgg._sum.credit ?? zero()).minus(repaidAgg._sum.debit ?? zero());
  const outstanding = disbursed.minus(repaid);
  const activeLoans = loans.filter(loan => loan.disbursement.reversals.length === 0).length;
  return {
    loanCount: activeLoans,
    disbursed: disbursed.toFixed(2),
    repaid: repaid.toFixed(2),
    outstanding: outstanding.toFixed(2),
    pendingCount,
  };
}

export async function listBorrowers(societyId: string, input: BorrowerListInput) {
  const where: Prisma.NonMemberBorrowerWhereInput = {
    societyId,
    ...(input.activeOnly ? { isActive: true } : {}),
    ...(input.search
      ? {
          OR: [
            { fullName: { contains: input.search } },
            { phone: { contains: input.search } },
            { borrowerNo: { contains: input.search } },
            { identityNumber: { contains: input.search } },
          ],
        }
      : {}),
  };
  return db.$transaction(async tx => {
    const [rows, total] = await Promise.all([
      tx.nonMemberBorrower.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      tx.nonMemberBorrower.count({ where }),
    ]);
    const items = await Promise.all(rows.map(async borrower => ({
      ...borrower,
      ...(await borrowerTotals(tx, societyId, borrower.id)),
    })));
    return { items, total, page: input.page, pageSize: input.pageSize, pages: Math.ceil(total / input.pageSize) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function getBorrower(societyId: string, id: string) {
  return db.$transaction(async tx => {
    const borrower = await tx.nonMemberBorrower.findUnique({ where: { societyId_id: { societyId, id } } });
    if (!borrower) throw new AppError(404, 'Non-member borrower not found');
    const [summary, loanRows, transactions] = await Promise.all([
      borrowerTotals(tx, societyId, id),
      tx.loan.findMany({
        where: { societyId, borrowerId: id },
        orderBy: { id: 'desc' },
        include: {
          disbursement: { select: { effectiveDate: true, transactionNo: true, reversals: { where: { status: 'POSTED' }, select: { id: true } } } },
        },
      }),
      tx.financialTransaction.findMany({
        where: { societyId, borrowerId: id, deletedAt: null },
        orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        take: 100,
        select: {
          id: true, transactionNo: true, type: true, status: true, amount: true, effectiveDate: true, reference: true, note: true,
          cashAccount: { select: { name: true } },
          reversalOf: { select: { transactionNo: true, type: true } },
        },
      }),
    ]);
    const loans = await Promise.all(loanRows.map(async loan => {
      const outstanding = await loanOutstanding(tx, societyId, loan.id);
      const cancelled = loan.disbursement.reversals.length > 0;
      const repaid = cancelled ? zero() : loan.principal.minus(outstanding);
      let remainingPaid = repaid;
      const schedule = principalSchedule(loan.principal.toFixed(2), loan.installmentCount, loan.firstDueDate.toISOString().slice(0, 10)).map(row => {
        const due = new Prisma.Decimal(row.amount);
        const allocated = Prisma.Decimal.min(remainingPaid, due);
        remainingPaid = remainingPaid.minus(allocated);
        const unpaid = due.minus(allocated);
        return { ...row, paid: allocated.toFixed(2), outstanding: cancelled ? '0.00' : unpaid.toFixed(2), status: cancelled ? 'CANCELLED' : unpaid.isZero() ? 'PAID' : row.dueDate < todayDhaka() ? 'OVERDUE' : 'DUE' };
      });
      return {
        ...loan,
        principal: loan.principal.toFixed(2),
        repaid: repaid.toFixed(2),
        outstanding: outstanding.toFixed(2),
        installmentAmount: schedule[0]!.amount,
        nextDueDate: schedule.find(row => row.status !== 'PAID' && row.status !== 'CANCELLED')?.dueDate ?? null,
        status: cancelled ? 'CANCELLED' : outstanding.isZero() ? 'SETTLED' : 'ACTIVE',
      };
    }));
    return {
      ...borrower,
      ...summary,
      loans,
      transactions: transactions.map(item => ({ ...item, amount: item.amount.toFixed(2) })),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

async function nextBorrowerNo(tx: Tx, societyId: string) {
  const existing = await tx.nonMemberBorrower.findMany({
    where: { societyId, borrowerNo: { startsWith: 'NML-' } },
    select: { borrowerNo: true },
  });
  let max = 0;
  for (const row of existing) {
    const match = /^NML-(\d+)$/.exec(row.borrowerNo);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `NML-${String(max + 1).padStart(4, '0')}`;
}

export async function createBorrower(societyId: string, actorId: string, input: BorrowerInput) {
  return db.$transaction(async tx => {
    await lockActiveSociety(tx, societyId);
    const borrowerNo = input.borrowerNo || (await nextBorrowerNo(tx, societyId));
    if (await tx.nonMemberBorrower.findUnique({ where: { societyId_borrowerNo: { societyId, borrowerNo } } })) {
      throw new AppError(409, 'Borrower number is already in use in this society');
    }
    const borrower = await tx.nonMemberBorrower.create({
      data: {
        societyId,
        borrowerNo,
        fullName: input.fullName,
        phone: input.phone,
        identityNumber: input.identityNumber ?? null,
        address: input.address ?? '',
        guarantorName: input.guarantorName ?? null,
        guarantorPhone: input.guarantorPhone ?? null,
        note: input.note ?? null,
        isActive: input.isActive ?? true,
      },
    });
    await audit(tx, actorId, 'FINANCE_BORROWER_CREATED', 'non_member_borrower', borrower.id, {
      borrowerNo: borrower.borrowerNo, fullName: borrower.fullName, phone: borrower.phone,
    }, societyId);
    return borrower;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 });
}

export async function updateBorrower(societyId: string, actorId: string, id: string, input: BorrowerUpdateInput) {
  return db.$transaction(async tx => {
    await lockActiveSociety(tx, societyId);
    const existing = await tx.nonMemberBorrower.findUnique({ where: { societyId_id: { societyId, id } } });
    if (!existing) throw new AppError(404, 'Non-member borrower not found');
    if (input.borrowerNo && input.borrowerNo !== existing.borrowerNo) {
      if (await tx.nonMemberBorrower.findUnique({ where: { societyId_borrowerNo: { societyId, borrowerNo: input.borrowerNo } } })) {
        throw new AppError(409, 'Borrower number is already in use in this society');
      }
    }
    const borrower = await tx.nonMemberBorrower.update({
      where: { societyId_id: { societyId, id } },
      data: {
        ...(input.borrowerNo !== undefined ? { borrowerNo: input.borrowerNo } : {}),
        ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.identityNumber !== undefined ? { identityNumber: input.identityNumber } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.guarantorName !== undefined ? { guarantorName: input.guarantorName } : {}),
        ...(input.guarantorPhone !== undefined ? { guarantorPhone: input.guarantorPhone } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    await audit(tx, actorId, 'FINANCE_BORROWER_UPDATED', 'non_member_borrower', borrower.id, input, societyId);
    return borrower;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 });
}
