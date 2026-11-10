import type { z } from 'zod';
import { db } from '../../config/database.js';
import { hashPassword } from '../../utils/password.js';
import { audit } from '../../services/audit.js';
import { AppError } from '../../utils/errors.js';
import type { createSocietySchema, updateSocietySchema } from './society.validator.js';

export async function list(page: number, search: string) {
  const where = search ? { OR: [{ name: { contains: search } }, { code: { contains: search } }] } : {};
  const [items, total] = await db.$transaction([
    db.society.findMany({ where, skip: (page - 1) * 20, take: 20, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], include: { _count: { select: { members: { where: { archivedAt: null } }, memberships: true } } } }),
    db.society.count({ where }),
  ]);
  return { items, total, page, pageSize: 20, pages: Math.ceil(total / 20) };
}
export async function create(input: z.infer<typeof createSocietySchema>, actorId: string) {
  const passwordHash = await hashPassword(input.admin.password);
  return db.$transaction(async tx => {
    const { admin, ...details } = input;
    const society = await tx.society.create({ data: details });
    const role = await tx.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
    const user = await tx.user.create({ data: { name: admin.name, email: admin.email, passwordHash, memberships: { create: { societyId: society.id, roleId: role.id } } } });
    await audit(tx, actorId, 'SOCIETY_CREATED', 'society', society.id, { name: society.name, code: society.code, adminUserId: user.id }, society.id);
    return society;
  });
}
export async function update(id: string, input: z.infer<typeof updateSocietySchema>, actorId: string) {
  return db.$transaction(async tx => {
    const before = await tx.society.findUnique({ where: { id } });
    if (!before) throw new AppError(404, 'Society not found');
    const { version, ...data } = input;
    const claimed = await tx.society.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
    if (!claimed.count) throw new AppError(409, 'This society changed. Reload and try again');
    await audit(tx, actorId, 'SOCIETY_UPDATED', 'society', id, { before: JSON.parse(JSON.stringify(before)), after: data }, id);
    return tx.society.findUniqueOrThrow({ where: { id } });
  });
}
