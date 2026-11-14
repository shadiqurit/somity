import type { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { db } from '../../config/database.js';
import { hashPassword } from '../../utils/password.js';
import { audit } from '../../services/audit.js';
import { assertActiveSociety } from '../../services/tenant.js';
import type { staffSchema } from './user.validator.js';

export async function list(page: number, societyId: string) {
  const [memberships, total] = await db.$transaction([
    db.societyMembership.findMany({ where: { societyId }, skip: (page - 1) * 20, take: 20, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], include: { user: { select: { id: true, email: true, name: true, isActive: true, mustChangePassword: true } }, role: { select: { code: true, name: true } } } }),
    db.societyMembership.count({ where: { societyId } }),
  ]);
  const items = memberships.map(m => ({ ...m.user, isActive: m.isActive && m.user.isActive, roles: [{ role: m.role }] }));
  return { items, total, page, pageSize: 20, pages: Math.ceil(total / 20) };
}

export async function listAll(page: number, search: string) {
  const where: Prisma.UserWhereInput = search ? { OR: [{ name: { contains: search } }, { email: { contains: search } }] } : {};
  const role = { select: { name: true } } as const;
  const pageSize = 20;
  const [users, total] = await db.$transaction([
    db.user.findMany({
      where, skip: (page - 1) * pageSize, take: pageSize, orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, email: true, isActive: true, roles: { select: { role } }, memberships: { select: { role } } },
    }),
    db.user.count({ where }),
  ]);
  const items = users.map(({ roles, memberships, ...user }) => ({
    ...user,
    roles: [...new Set([...roles, ...memberships].map(entry => entry.role.name))].sort().map(name => ({ role: { name } })),
  }));
  return { items, total, page, pageSize, pages: Math.ceil(total / pageSize) };
}

export async function create(input: z.infer<typeof staffSchema>, actorId: string, societyId: string) {
  const passwordHash = await hashPassword(input.password);
  return db.$transaction(async tx => {
    await assertActiveSociety(tx, societyId);
    const role = await tx.role.findUniqueOrThrow({ where: { code: input.roleCode } });
    const created = await tx.user.create({ data: { name: input.name, email: input.email, passwordHash, memberships: { create: { societyId, roleId: role.id } } }, select: { id: true, name: true, email: true, mustChangePassword: true } });
    await audit(tx, actorId, 'STAFF_CREATED', 'user', created.id, { name: input.name, email: input.email, role: input.roleCode }, societyId);
    return created;
  });
}
