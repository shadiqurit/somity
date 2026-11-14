import { z } from 'zod';
import { emailSchema, passwordSchema } from '../auth/auth.validator.js';
export const staffSchema = z.object({ name: z.string().trim().min(2).max(120), email: emailSchema, password: passwordSchema, roleCode: z.enum(['ADMIN', 'ACCOUNTANT', 'APPROVER']) }).strict();
export const userListSchema = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1) });
export const platformUserListSchema = userListSchema.extend({ search: z.string().trim().max(191).default('') });
export const userIdSchema = z.string().min(1).max(30);
export const setPasswordSchema = z.object({ password: passwordSchema }).strict();
