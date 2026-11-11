import { z } from 'zod';

export const moneySchema = z.string().regex(/^(0|[1-9]\d{0,17})(\.\d{1,2})?$/, 'Use a positive amount with at most 2 decimal places').refine(v => /[1-9]/.test(v), 'Amount must be greater than zero');
export const idSchema = z.string().min(1).max(30).regex(/^[a-zA-Z0-9_-]+$/);
export const keySchema = z.string().min(16).max(80).regex(/^[a-zA-Z0-9_-]+$/);
export function todayDhaka() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
const effectiveDate = z.iso.date().refine(value => value <= todayDhaka(), 'Future-dated transactions are not supported');
export const transactionTypes = ['DEPOSIT', 'WITHDRAWAL', 'LOAN_DISBURSEMENT', 'LOAN_REPAYMENT', 'INVESTMENT_PURCHASE', 'INVESTMENT_RETURN', 'EXPENSE', 'TRANSFER'] as const;
const optionalId = z.union([idSchema, z.literal(''), z.null()]).optional().transform(v => v || null);
const nonnegativeMoney = z.string().regex(/^(0|[1-9]\d{0,17})(\.\d{1,2})?$/);
export const transactionSchema = z.object({
  type: z.enum(transactionTypes), memberId: optionalId, cashAccountId: idSchema, amount: moneySchema, effectiveDate,
  reference: z.string().trim().max(120).default(''), note: z.string().trim().max(500).default(''),
  loanId: optionalId, investmentId: optionalId, destinationAccountId: optionalId,
  installmentCount: z.number().int().min(1).max(600).optional(), firstDueDate: z.iso.date().optional(),
  title: z.string().trim().max(120).optional(), counterparty: z.string().trim().max(120).optional(),
  principalReturned: nonnegativeMoney.optional(), profit: nonnegativeMoney.optional(),
  category: z.string().trim().max(80).optional(), payee: z.string().trim().max(120).optional(),
}).strict().superRefine((v, ctx) => {
  const require = (ok: unknown, field: string, message: string) => { if (!ok) ctx.addIssue({ code: 'custom', path: [field], message }); };
  if (['DEPOSIT', 'WITHDRAWAL', 'LOAN_DISBURSEMENT'].includes(v.type)) require(v.memberId, 'memberId', 'Choose a member');
  if (!['DEPOSIT', 'WITHDRAWAL', 'LOAN_DISBURSEMENT'].includes(v.type)) require(!v.memberId, 'memberId', 'Member is determined by the linked loan or is not applicable');
  if (v.type === 'LOAN_DISBURSEMENT') { require(v.installmentCount, 'installmentCount', 'Enter installment count'); require(v.firstDueDate && v.firstDueDate >= v.effectiveDate, 'firstDueDate', 'First due date must be on or after disbursement'); }
  if (v.type === 'LOAN_REPAYMENT') require(v.loanId, 'loanId', 'Choose a loan'); else require(!v.loanId, 'loanId', 'Loan reference is not applicable');
  if (v.type === 'INVESTMENT_PURCHASE') { require(v.title && v.title.length >= 2, 'title', 'Enter investment title'); require(v.counterparty && v.counterparty.length >= 2, 'counterparty', 'Enter counterparty'); }
  if (v.type === 'INVESTMENT_RETURN') { require(v.investmentId, 'investmentId', 'Choose an investment'); require(v.principalReturned !== undefined, 'principalReturned', 'Enter principal returned'); require(v.profit !== undefined, 'profit', 'Enter profit'); } else require(!v.investmentId, 'investmentId', 'Investment reference is not applicable');
  if (v.type === 'EXPENSE') { require(v.category && v.category.length >= 2, 'category', 'Enter expense category'); require(v.payee && v.payee.length >= 2, 'payee', 'Enter payee'); }
  if (v.type === 'TRANSFER') require(v.destinationAccountId && v.destinationAccountId !== v.cashAccountId, 'destinationAccountId', 'Choose a different destination cash/bank account'); else require(!v.destinationAccountId, 'destinationAccountId', 'Destination is only used for transfers');
});
export const reversalSchema = z.object({ effectiveDate, note: z.string().trim().min(5).max(500) }).strict();
export const decisionSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']), comment: z.string().trim().max(500).default('') }).strict().refine(v => v.decision !== 'REJECT' || v.comment.length >= 5, { path: ['comment'], message: 'Give a reason for rejection (at least 5 characters)' });
export const accountSchema = z.object({ code: z.string().trim().min(2).max(40).regex(/^[a-zA-Z0-9-]+$/).transform(v => v.toUpperCase()).refine(v => !['MEMBER-SAVINGS','SYS-LOANS','SYS-INVESTMENTS','SYS-PROFIT','SYS-EXPENSE'].includes(v), 'Reserved system account code'), name: z.string().trim().min(2).max(120), kind: z.enum(['CASH', 'BANK']), bankName: z.string().trim().max(120).default(''), accountNumberLast4: z.union([z.string().regex(/^\d{4}$/), z.literal('')]).default('') }).strict().refine(v => v.kind !== 'BANK' || v.bankName.length >= 2, { path: ['bankName'], message: 'Bank name is required' });
export const policySchema = z.object({ version: z.number().int().min(0), requiredApprovals: z.number().int().min(1).max(2), allowSelfApproval: z.boolean() }).strict();
export const dateRangeSchema = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() }).refine(v => !v.from || !v.to || v.from <= v.to, { path: ['to'], message: 'End date must be on or after start date' });
export const listSchema = dateRangeSchema.safeExtend({ page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20), status: z.enum(['PENDING', 'POSTED', 'REJECTED', 'CANCELLED']).optional(), type: z.enum([...transactionTypes, 'REVERSAL']).optional(), memberId: idSchema.optional() });
export type TransactionInput = z.infer<typeof transactionSchema>;
export type FinanceListInput = z.infer<typeof listSchema>;

