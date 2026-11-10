import { z } from 'zod';

export const moneySchema = z.string().regex(/^(0|[1-9]\d{0,17})(\.\d{1,2})?$/, 'Use a positive amount with at most 2 decimal places').refine(v => /[1-9]/.test(v), 'Amount must be greater than zero');
export const idSchema = z.string().min(1).max(30).regex(/^[a-zA-Z0-9_-]+$/);
export const keySchema = z.string().min(16).max(80).regex(/^[a-zA-Z0-9_-]+$/);
export function todayDhaka() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
const effectiveDate = z.iso.date().refine(value => value <= todayDhaka(), 'Future-dated transactions are not supported');
export const transactionSchema = z.object({ type: z.enum(['DEPOSIT', 'WITHDRAWAL']), memberId: idSchema, cashAccountId: idSchema, amount: moneySchema, effectiveDate, reference: z.string().trim().max(120).default(''), note: z.string().trim().max(500).default('') }).strict();
export const reversalSchema = z.object({ effectiveDate, note: z.string().trim().min(5).max(500) }).strict();
export const decisionSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']), comment: z.string().trim().max(500).default('') }).strict().refine(v => v.decision !== 'REJECT' || v.comment.length >= 5, { path: ['comment'], message: 'Give a reason for rejection (at least 5 characters)' });
export const accountSchema = z.object({ code: z.string().trim().min(2).max(40).regex(/^[a-zA-Z0-9-]+$/).transform(v => v.toUpperCase()).refine(v => v !== 'MEMBER-SAVINGS', 'Reserved system account code'), name: z.string().trim().min(2).max(120), kind: z.enum(['CASH', 'BANK']), bankName: z.string().trim().max(120).default(''), accountNumberLast4: z.union([z.string().regex(/^\d{4}$/), z.literal('')]).default('') }).strict().refine(v => v.kind !== 'BANK' || v.bankName.length >= 2, { path: ['bankName'], message: 'Bank name is required' });
export const policySchema = z.object({ version: z.number().int().min(0), requiredApprovals: z.number().int().min(1).max(2), allowSelfApproval: z.boolean() }).strict();
export const dateRangeSchema = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() }).refine(v => !v.from || !v.to || v.from <= v.to, { path: ['to'], message: 'End date must be on or after start date' });
export const listSchema = dateRangeSchema.safeExtend({ page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20), status: z.enum(['PENDING', 'POSTED', 'REJECTED', 'CANCELLED']).optional(), type: z.enum(['DEPOSIT', 'WITHDRAWAL', 'REVERSAL']).optional(), memberId: idSchema.optional() });
export type TransactionInput = z.infer<typeof transactionSchema>;
export type FinanceListInput = z.infer<typeof listSchema>;

