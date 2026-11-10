import { z } from 'zod';
export const emailSchema = z.email().max(191).transform(v => v.toLowerCase());
export const passwordSchema = z.string().min(12).max(128).regex(/[a-z]/, 'Include a lowercase letter').regex(/[A-Z]/, 'Include an uppercase letter').regex(/[0-9]/, 'Include a number');
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) }).strict();
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema }).strict().refine(v => v.currentPassword !== v.newPassword, { message: 'Choose a different password', path: ['newPassword'] });
