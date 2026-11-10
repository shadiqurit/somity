import { z } from 'zod';
import { emailSchema, passwordSchema } from '../auth/auth.validator.js';
const contactEmail = z.union([emailSchema, z.literal(''), z.null()]).optional().transform(v => v || null);
export const societySchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9-]+$/, 'Use letters, numbers and hyphens').transform(v => v.toUpperCase()),
  email: contactEmail, phone: z.string().trim().max(25).optional().transform(v => v || null),
  address: z.string().trim().max(500).optional().transform(v => v || null),
}).strict();
export const createSocietySchema = societySchema.extend({
  admin: z.object({ name: z.string().trim().min(2).max(120), email: emailSchema, password: passwordSchema }).strict(),
});
export const updateSocietySchema = societySchema.extend({ isActive: z.boolean(), version: z.number().int().positive() });
export const societyListSchema = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), search: z.string().trim().max(120).default('') });
