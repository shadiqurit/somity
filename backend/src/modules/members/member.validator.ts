import { z } from 'zod';
import { emailSchema, passwordSchema } from '../auth/auth.validator.js';
const phone = z.string().trim().min(6).max(25).regex(/^\+?[0-9 ()-]+$/, 'Enter a valid phone number');
const optionalEmail = z.union([emailSchema, z.literal(''), z.null()]).optional().transform(v => v || null);
const nominee = z.object({
  fullName: z.string().trim().min(2).max(120), relationship: z.string().trim().min(2).max(80),
  phone, address: z.string().trim().min(3).max(500),
  sharePercent: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/, 'Use at most 2 decimal places').refine(v => Number(v) > 0 && Number(v) <= 100, 'Share must be between 0.01 and 100'),
}).strict();
export function sharesTotal100(values: string[]) { return values.reduce((sum, v) => sum + Math.round(Number(v) * 100), 0) === 10000; }
export const memberSchema = z.object({
  fullName: z.string().trim().min(2).max(120), phone, email: optionalEmail,
  address: z.string().trim().min(3).max(500),
  joinedAt: z.iso.date(), status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).default('ACTIVE'),
  nominees: z.array(nominee).min(1).max(10).refine(v => sharesTotal100(v.map(n => n.sharePercent)), 'Nominee shares must total exactly 100%'),
}).strict();
export const updateMemberSchema = memberSchema.extend({ version: z.number().int().positive() });
export const archiveSchema = z.object({ version: z.number().int().positive() }).strict();
export const listSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().max(120).default(''), status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
  sort: z.enum(['createdAt', 'fullName', 'memberNo']).default('createdAt'), direction: z.enum(['asc', 'desc']).default('desc'),
});
export const memberLoginSchema = z.object({ email: emailSchema, password: passwordSchema }).strict();
export type MemberInput = z.infer<typeof memberSchema>;
