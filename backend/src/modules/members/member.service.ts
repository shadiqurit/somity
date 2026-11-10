import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '../../config/database.js';
import { AppError } from '../../utils/errors.js';
import { hashPassword } from '../../utils/password.js';
import { assertActiveSociety } from '../../services/tenant.js';
import { audit } from '../../services/audit.js';
import { memberInclude, presentMember } from './member.repository.js';
import type { MemberInput } from './member.validator.js';
import type { z } from 'zod';
import type { listSchema } from './member.validator.js';

export async function list(input: z.infer<typeof listSchema>, societyId: string) {
  const where: Prisma.MemberWhereInput = { societyId, archivedAt: null, ...(input.status ? { status: input.status } : {}), ...(input.search ? { OR: ['fullName', 'memberNo', 'phone', 'email'].map(key => ({ [key]: { contains: input.search } })) } : {}) };
  const [items, total] = await db.$transaction([
    db.member.findMany({ where, skip: (input.page - 1) * input.pageSize, take: input.pageSize, orderBy: [{ [input.sort]: input.direction }, { id: 'asc' }], include: memberInclude }),
    db.member.count({ where }),
  ]);
  return { items: items.map(presentMember), total, page: input.page, pageSize: input.pageSize, pages: Math.ceil(total / input.pageSize) };
}
export async function get(id: string, societyId: string) {
  const member = await db.member.findFirst({ where: { id, societyId, archivedAt: null }, include: memberInclude });
  if (!member) throw new AppError(404, 'Member not found');
  return presentMember(member);
}
function memberData(input: MemberInput, societyId: string) {
  const { nominees, joinedAt, ...fields } = input;
  return { ...fields, joinedAt: new Date(`${joinedAt}T00:00:00.000Z`), nominees: { create: nominees } };
}
export async function create(input: MemberInput, actorId: string, societyId: string) {
  return db.$transaction(async tx => {
    await assertActiveSociety(tx, societyId);
    const memberNo = `MEM-${new Date().getUTCFullYear()}-${randomBytes(5).toString('hex').toUpperCase()}`;
    const member = await tx.member.create({ data: { ...memberData(input, societyId), memberNo, societyId }, include: memberInclude });
    await audit(tx, actorId, 'MEMBER_CREATED', 'member', member.id, { after: input }, societyId);
    return presentMember(member);
  });
}
export async function update(id: string, input: MemberInput & { version: number }, actorId: string, societyId: string) {
  return db.$transaction(async tx => {
    await assertActiveSociety(tx, societyId);
    const before = await tx.member.findFirst({ where: { id, societyId, archivedAt: null }, include: { nominees: true } });
    if (!before) throw new AppError(404, 'Member not found');
    const { version, ...fields } = input;
    const { nominees, ...data } = memberData(fields, societyId);
    const claimed = await tx.member.updateMany({ where: { id, societyId, version, archivedAt: null }, data: { ...data, version: { increment: 1 } } });
    if (!claimed.count) throw new AppError(409, 'This member changed. Reload the profile and try again');
    await tx.nominee.deleteMany({ where: { memberId: id, societyId } });
    await tx.nominee.createMany({ data: input.nominees.map(n => ({ ...n, memberId: id, societyId })) });
    await audit(tx, actorId, 'MEMBER_UPDATED', 'member', id, { before: JSON.parse(JSON.stringify(before)), after: input }, societyId);
    return presentMember(await tx.member.findUniqueOrThrow({ where: { societyId_id: { societyId, id } }, include: memberInclude }));
  });
}
export async function archive(id: string, version: number, actorId: string, societyId: string) {
  await db.$transaction(async tx => {
    await assertActiveSociety(tx, societyId);
    const before = await tx.member.findFirst({ where: { id, societyId, archivedAt: null } });
    if (!before) throw new AppError(404, 'Member not found');
    const claimed = await tx.member.updateMany({ where: { id, societyId, version, archivedAt: null }, data: { archivedAt: new Date(), status: 'INACTIVE', version: { increment: 1 } } });
    if (!claimed.count) throw new AppError(409, 'This member changed. Reload and try again');
    if (before.userId) {
      await tx.societyMembership.update({ where: { societyId_userId: { societyId, userId: before.userId } }, data: { isActive: false } });
    }
    await audit(tx, actorId, 'MEMBER_ARCHIVED', 'member', id, { memberNo: before.memberNo }, societyId);
  });
}
export async function createLogin(id: string, email: string, password: string, actorId: string, societyId: string) {
  const passwordHash = await hashPassword(password);
  return db.$transaction(async tx => {
    await assertActiveSociety(tx, societyId);
    const member = await tx.member.findFirst({ where: { id, societyId, archivedAt: null } });
    if (!member) throw new AppError(404, 'Member not found');
    if (member.userId) throw new AppError(409, 'This member already has a login');
    const claimed = await tx.member.updateMany({ where: { id, societyId, archivedAt: null, userId: null, version: member.version }, data: { version: { increment: 1 } } });
    if (!claimed.count) throw new AppError(409, 'This member changed. Reload and try again');
    const role = await tx.role.findUniqueOrThrow({ where: { code: 'MEMBER' } });
    const user = await tx.user.create({ data: { name: member.fullName, email, passwordHash, memberships: { create: { societyId, roleId: role.id } } } });
    await tx.member.update({ where: { societyId_id: { societyId, id } }, data: { userId: user.id } });
    await audit(tx, actorId, 'MEMBER_LOGIN_CREATED', 'member', id, { userId: user.id, email }, societyId);
    return { id: user.id, email: user.email, mustChangePassword: true };
  });
}
