import type { Prisma } from '@prisma/client';
import { db } from '../../config/database.js';
import { AppError } from '../../utils/errors.js';
import { audit } from '../../services/audit.js';
import type { NoteBodyInput, NoteCategoryValue, NoteListInput } from './note.validator.js';
import { noteCategories } from './note.validator.js';

const noteSelect = {
  id: true,
  societyId: true,
  category: true,
  title: true,
  content: true,
  memberId: true,
  createdAt: true,
  updatedAt: true,
  member: { select: { id: true, memberNo: true, fullName: true } },
  createdBy: { select: { id: true, name: true } },
  updatedBy: { select: { id: true, name: true } },
} satisfies Prisma.NoteSelect;

async function ensureMemberInSociety(tx: Prisma.TransactionClient, societyId: string, memberId?: string | null) {
  if (!memberId) return null;
  const member = await tx.member.findFirst({ where: { societyId, id: memberId }, select: { id: true } });
  if (!member) throw new AppError(404, 'Selected member was not found in this society');
  return member.id;
}

export async function list(societyId: string, input: NoteListInput) {
  const where: Prisma.NoteWhereInput = {
    societyId,
    ...(input.category ? { category: input.category } : {}),
    ...(input.memberId ? { memberId: input.memberId } : {}),
    ...(input.search
      ? {
          OR: [
            { title: { contains: input.search } },
            { content: { contains: input.search } },
            { member: { is: { fullName: { contains: input.search } } } },
            { member: { is: { memberNo: { contains: input.search } } } },
          ],
        }
      : {}),
  };

  const [items, total, grouped] = await Promise.all([
    db.note.findMany({
      where,
      select: noteSelect,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    db.note.count({ where }),
    db.note.groupBy({
      by: ['category'],
      where: { societyId },
      _count: { _all: true },
    }),
  ]);

  const categoryCounts = Object.fromEntries(noteCategories.map(category => [category, 0])) as Record<NoteCategoryValue, number>;
  let allCount = 0;
  for (const row of grouped) {
    categoryCounts[row.category] = row._count._all;
    allCount += row._count._all;
  }

  return {
    items,
    total,
    allCount,
    page: input.page,
    pageSize: input.pageSize,
    categoryCounts,
  };
}

export async function create(societyId: string, input: NoteBodyInput, actorId: string) {
  return db.$transaction(async tx => {
    const memberId = await ensureMemberInSociety(tx, societyId, input.memberId);
    const note = await tx.note.create({
      data: {
        societyId,
        category: input.category,
        title: input.title,
        content: input.content,
        memberId,
        createdById: actorId,
      },
      select: noteSelect,
    });
    await audit(tx, actorId, 'NOTE_CREATED', 'note', note.id, { category: note.category, title: note.title }, societyId);
    return note;
  });
}

export async function update(societyId: string, id: string, input: NoteBodyInput, actorId: string) {
  return db.$transaction(async tx => {
    const existing = await tx.note.findFirst({ where: { societyId, id }, select: { id: true } });
    if (!existing) throw new AppError(404, 'Note not found');
    const memberId = await ensureMemberInSociety(tx, societyId, input.memberId);
    const note = await tx.note.update({
      where: { id: existing.id },
      data: {
        category: input.category,
        title: input.title,
        content: input.content,
        memberId,
        updatedById: actorId,
      },
      select: noteSelect,
    });
    await audit(tx, actorId, 'NOTE_UPDATED', 'note', note.id, { category: note.category, title: note.title }, societyId);
    return note;
  });
}

export async function remove(societyId: string, id: string, actorId: string) {
  return db.$transaction(async tx => {
    const existing = await tx.note.findFirst({
      where: { societyId, id },
      select: { id: true, category: true, title: true },
    });
    if (!existing) throw new AppError(404, 'Note not found');
    await tx.note.delete({ where: { id: existing.id } });
    await audit(tx, actorId, 'NOTE_DELETED', 'note', existing.id, { category: existing.category, title: existing.title }, societyId);
    return { deleted: true, id: existing.id };
  });
}
