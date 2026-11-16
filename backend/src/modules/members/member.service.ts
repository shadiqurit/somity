import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '../../config/database.js';
import { AppError } from '../../utils/errors.js';
import { hashPassword } from '../../utils/password.js';
import { assertActiveSociety, lockActiveSociety } from '../../services/tenant.js';
import { audit } from '../../services/audit.js';
import { assertMemberSettled } from '../finance/finance.service.js';
import { describeSettlement, findSettlement, memberDues, pendingMemberTransactions } from '../finance/finance.settlement.js';
import { memberDirectoryOmit, memberInclude, presentMember } from './member.repository.js';
import type { MemberInput, updateMemberSchema } from './member.validator.js';
import type { z } from 'zod';
import type { listSchema } from './member.validator.js';

export async function list(input: z.infer<typeof listSchema>, societyId: string) {
  const where: Prisma.MemberWhereInput = { societyId, archivedAt: null, ...(input.status ? { status: input.status } : {}), ...(input.search ? { OR: ['fullName', 'memberNo', 'phone', 'email'].map(key => ({ [key]: { contains: input.search } })) } : {}) };
  const [items, total] = await db.$transaction([
    db.member.findMany({
      where,
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      orderBy: [{ [input.sort]: input.direction }, { id: 'asc' }],
      omit: memberDirectoryOmit,
      include: { ...memberInclude, nominees: { ...memberInclude.nominees, omit: { identityNumber: true } } },
    }),
    db.member.count({ where }),
  ]);
  return { items: items.map(presentMember), total, page: input.page, pageSize: input.pageSize, pages: Math.ceil(total / input.pageSize) };
}
export async function get(id: string, societyId: string) {
  const member = await db.member.findFirst({ where: { id, societyId, archivedAt: null }, include: memberInclude });
  if (!member) throw new AppError(404, 'Member not found');
  return presentMember(member);
}
function memberData({ nominees, joinedAt, dateOfBirth, ...fields }: Omit<z.infer<typeof updateMemberSchema>, 'version'>) {
  return {
    ...fields,
    joinedAt: new Date(`${joinedAt}T00:00:00.000Z`),
    dateOfBirth: dateOfBirth ? new Date(`${dateOfBirth}T00:00:00.000Z`) : dateOfBirth,
  };
}

function memberAuditSnapshot<T extends {
  identityNumber?: string | null;
  dateOfBirth?: string | Date | null;
  nominees: { identityNumber?: string | null }[];
}>({ identityNumber, dateOfBirth, nominees, ...member }: T) {
  return { ...member, nominees: nominees.map(({ identityNumber, ...nominee }) => nominee) };
}

async function disableMemberLogin(tx: Prisma.TransactionClient, societyId: string, userId: string | null) {
  if (userId) await tx.societyMembership.update({ where: { societyId_userId: { societyId, userId } }, data: { isActive: false } });
}

async function completeSettlement(tx: Prisma.TransactionClient, societyId: string, memberId: string, actorId: string) {
  const settlement = await findSettlement(tx, societyId, memberId);
  if (!settlement || settlement.closedAt) return;
  await tx.memberSettlement.update({ where: { id: settlement.id }, data: { closedAt: new Date() } });
  await audit(tx, actorId, 'MEMBER_SETTLEMENT_COMPLETED', 'member', memberId, { settlementId: settlement.id }, societyId);
}

export function settlement(societyId: string, memberId: string) {
  return db.$transaction(tx => describeSettlement(tx, societyId, memberId), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });
}

export async function startSettlement(societyId: string, memberId: string, actorId: string) {
  await db.$transaction(async tx => {
    await lockActiveSociety(tx, societyId);
    const member = await tx.member.findUnique({
      where: { societyId_id: { societyId, id: memberId } },
      select: { status: true, archivedAt: true },
    });
    if (!member || member.archivedAt) throw new AppError(404, 'Member not found');
    if (member.status === 'CLOSED') throw new AppError(409, 'This membership is closed');
    if (await findSettlement(tx, societyId, memberId)) return;
    if (await pendingMemberTransactions(tx, societyId, memberId)) {
      throw new AppError(409, 'Resolve all pending member transactions before starting final settlement');
    }
    const dues = await memberDues(tx, societyId, memberId);
    const record = await tx.memberSettlement.create({ data: { societyId, memberId, dues } });
    await audit(tx, actorId, 'MEMBER_SETTLEMENT_STARTED', 'member', memberId, { settlementId: record.id, dues }, societyId);
  });
  return settlement(societyId, memberId);
}

export async function closeSettlement(societyId: string, memberId: string, actorId: string) {
  await db.$transaction(async tx => {
    await lockActiveSociety(tx, societyId);
    const record = await findSettlement(tx, societyId, memberId);
    if (!record) throw new AppError(404, 'Member settlement not found');
    if (record.closedAt) return;
    await assertMemberSettled(tx, societyId, memberId);
    const member = await tx.member.update({
      where: { societyId_id: { societyId, id: memberId } },
      data: { status: 'CLOSED', version: { increment: 1 } },
      select: { userId: true },
    });
    await disableMemberLogin(tx, societyId, member.userId);
    await completeSettlement(tx, societyId, memberId, actorId);
    await audit(tx, actorId, 'MEMBER_CLOSED', 'member', memberId, { settlementId: record.id }, societyId);
  });
  return settlement(societyId, memberId);
}

export async function create(input: MemberInput, actorId: string, societyId: string) {
  return db.$transaction(async tx => {
    await assertActiveSociety(tx, societyId);
    const memberNo = `MEM-${new Date().getUTCFullYear()}-${randomBytes(5).toString('hex').toUpperCase()}`;
    const member = await tx.member.create({ data: { ...memberData(input), memberNo, societyId, nominees: { create: input.nominees } }, include: memberInclude });
    await audit(tx, actorId, 'MEMBER_CREATED', 'member', member.id, { after: memberAuditSnapshot(input) }, societyId);
    return presentMember(member);
  });
}
export async function update(id: string, input: z.infer<typeof updateMemberSchema>, actorId: string, societyId: string) {
  return db.$transaction(async tx => {
    if (input.status === 'CLOSED') await lockActiveSociety(tx, societyId);
    else await assertActiveSociety(tx, societyId);
    const before = await tx.member.findFirst({ where: { id, societyId, archivedAt: null }, include: { nominees: true } });
    if (!before) throw new AppError(404, 'Member not found');
    const { version, ...fields } = input;
    if (before.version !== version) throw new AppError(409, 'This member changed. Reload the profile and try again');
    if (before.status === 'CLOSED' && fields.status !== 'CLOSED') throw new AppError(409, 'This membership is already closed');
    const closing = fields.status === 'CLOSED' && before.status !== 'CLOSED';
    if (closing) await assertMemberSettled(tx, societyId, id);
    const data = memberData(fields);
    const claimed = await tx.member.updateMany({ where: { id, societyId, version, archivedAt: null }, data: { ...data, version: { increment: 1 } } });
    if (!claimed.count) throw new AppError(409, 'This member changed. Reload the profile and try again');
    await tx.nominee.deleteMany({ where: { memberId: id, societyId } });
    await tx.nominee.createMany({ data: input.nominees.map(n => ({ ...n, memberId: id, societyId })) });
    if (closing) {
      await disableMemberLogin(tx, societyId, before.userId);
      await completeSettlement(tx, societyId, id, actorId);
    }
    await audit(tx, actorId, closing ? 'MEMBER_CLOSED' : 'MEMBER_UPDATED', 'member', id, { before: JSON.parse(JSON.stringify(memberAuditSnapshot(before))), after: memberAuditSnapshot(input) }, societyId);
    return presentMember(await tx.member.findUniqueOrThrow({ where: { societyId_id: { societyId, id } }, include: memberInclude }));
  });
}
export async function archive(id: string, version: number, actorId: string, societyId: string) {
  await db.$transaction(async tx => {
    await lockActiveSociety(tx, societyId);
    const before = await tx.member.findFirst({ where: { id, societyId, archivedAt: null } });
    if (!before) throw new AppError(404, 'Member not found');
    if (before.version !== version) throw new AppError(409, 'This member changed. Reload and try again');
    await assertMemberSettled(tx, societyId, id);
    const claimed = await tx.member.updateMany({ where: { id, societyId, version, archivedAt: null }, data: { archivedAt: new Date(), status: 'CLOSED', version: { increment: 1 } } });
    if (!claimed.count) throw new AppError(409, 'This member changed. Reload and try again');
    await disableMemberLogin(tx, societyId, before.userId);
    await completeSettlement(tx, societyId, id, actorId);
    await audit(tx, actorId, 'MEMBER_ARCHIVED', 'member', id, { memberNo: before.memberNo }, societyId);
  });
}
export async function createLogin(id: string, email: string, password: string, actorId: string, societyId: string) {
  const passwordHash = await hashPassword(password);
  return db.$transaction(async tx => {
    await assertActiveSociety(tx, societyId);
    const member = await tx.member.findFirst({ where: { id, societyId, archivedAt: null } });
    if (!member) throw new AppError(404, 'Member not found');
    if (member.status === 'CLOSED') throw new AppError(409, 'This membership is closed');
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
