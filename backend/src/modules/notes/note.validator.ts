import { z } from 'zod';

export const noteCategories = ['MEMBER', 'LOAN', 'DUES', 'BUSINESS', 'INVESTMENT', 'OTHER'] as const;
export type NoteCategoryValue = (typeof noteCategories)[number];

const idSchema = z.string().trim().min(1).max(30).regex(/^[a-zA-Z0-9_-]+$/, 'Invalid ID');

const optionalMemberId = z.preprocess(
  value => (typeof value === 'string' && value.trim() === '' ? null : value),
  idSchema.nullable().optional(),
);

export const noteListSchema = z.object({
  category: z.enum(noteCategories).optional(),
  memberId: idSchema.optional(),
  search: z.string().trim().max(120).optional().default(''),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const noteBodySchema = z.object({
  category: z.enum(noteCategories).default('OTHER'),
  title: z.string().trim().min(1, 'Title is required').max(160, 'Title must be at most 160 characters'),
  content: z.string().trim().min(1, 'Note content is required').max(10000, 'Note is too long'),
  memberId: optionalMemberId,
});

export type NoteListInput = z.infer<typeof noteListSchema>;
export type NoteBodyInput = z.infer<typeof noteBodySchema>;
