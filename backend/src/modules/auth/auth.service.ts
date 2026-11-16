import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Prisma } from '@prisma/client';
import { db } from '../../config/database.js';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';
import { audit } from '../../services/audit.js';

const roleInclude = { permissions: { include: { permission: true } } } as const;
export const userInclude = {
  roles: { include: { role: { include: roleInclude } } },
  memberships: { include: { society: true, role: { include: roleInclude }, member: { select: { id: true, archivedAt: true } } }, orderBy: { createdAt: 'asc' } },
} as const;
type FullUser = NonNullable<Awaited<ReturnType<typeof findUser>>>;
export function findUser(id: string) { return db.user.findUnique({ where: { id }, include: userInclude }); }
function platformRole(user: FullUser) {
  return user.roles.find(({ role }) => role.code === 'SUPER_ADMIN')?.role
    ?? user.roles.find(({ role }) => role.code === 'ADMIN')?.role;
}
function activeMemberships(user: FullUser) { return user.memberships.filter(m => m.isActive && m.society.isActive && !m.member?.archivedAt); }
export function canSignIn(user: FullUser) { return user.isActive && (!!platformRole(user) || activeMemberships(user).length > 0); }
export async function publicUser(user: FullUser, requestedSocietyId?: string) {
  const platform = platformRole(user);
  const memberships = activeMemberships(user);
  const available = platform
    ? await db.society.findMany({ where: { isActive: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
    : memberships.map(m => m.society);
  if (!platform && requestedSocietyId && !memberships.some(m => m.societyId === requestedSocietyId)) throw new AppError(403, 'You do not have access to this society');
  const society = requestedSocietyId ? available.find(s => s.id === requestedSocietyId) ?? null : available[0] ?? null;
  const membership = memberships.find(m => m.societyId === society?.id);
  const role = platform ?? membership?.role;
  return {
    id: user.id, email: user.email, name: user.name, mustChangePassword: user.mustChangePassword,
    isSuperAdmin: platform?.code === 'SUPER_ADMIN', roles: role ? [role.code] : [], permissions: role?.permissions.map(p => p.permission.code) ?? [],
    memberId: membership?.member?.id ?? null, societyId: society?.id ?? null,
    society: society ? { id: society.id, code: society.code, name: society.name } : null,
    societies: available.map(s => ({ id: s.id, code: s.code, name: s.name })),
  };
}
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function sessionData(userId: string, familyId: string = randomUUID()) {
  const refreshToken = randomBytes(48).toString('base64url');
  return { refreshToken, data: { userId, familyId, tokenHash: digest(refreshToken), expiresAt: new Date(Date.now() + 7 * 86400000) } };
}
function accessToken(userId: string, sessionId: string) {
  return jwt.sign({ sid: sessionId }, env.JWT_ACCESS_SECRET, { subject: userId, expiresIn: '15m', issuer: 'somity-api', audience: 'somity-web', algorithm: 'HS256' });
}
const dummyHash = hashPassword('DummyPassword123456');

// Serialize session creation with password updates and their session revocation.
async function requireCurrentPasswordHash(tx: Prisma.TransactionClient, userId: string, passwordHash: string) {
  const [user] = await tx.$queryRaw<{ passwordHash: string }[]>`SELECT passwordHash FROM users WHERE id = ${userId} FOR UPDATE`;
  if (user?.passwordHash !== passwordHash) throw new AppError(401, 'Password changed. Please sign in again');
}

export async function login(email: string, password: string) {
  const user = await db.user.findUnique({ where: { email }, include: userInclude });
  const valid = await verifyPassword(password, user?.passwordHash ?? await dummyHash);
  if (!user || !valid || !canSignIn(user)) throw new AppError(401, 'Invalid email or password');
  const next = sessionData(user.id);
  const session = await db.$transaction(async tx => {
    await requireCurrentPasswordHash(tx, user.id, user.passwordHash);
    const session = await tx.refreshSession.create({ data: next.data });
    await audit(tx, user.id, 'AUTH_LOGIN', 'user', user.id);
    return session;
  });
  return { accessToken: accessToken(user.id, session.id), refreshToken: next.refreshToken, user: await publicUser(user) };
}
export async function refresh(token: string, societyId?: string) {
  const session = await db.refreshSession.findUnique({ where: { tokenHash: digest(token) }, include: { user: { include: userInclude } } });
  if (!session) throw new AppError(401, 'Session expired. Please sign in again');
  if (session.revokedAt) {
    await db.refreshSession.updateMany({ where: { familyId: session.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    throw new AppError(401, 'Session reuse detected. Please sign in again');
  }
  if (session.expiresAt <= new Date() || !canSignIn(session.user)) throw new AppError(401, 'Session expired');
  const principal = await publicUser(session.user, societyId);
  const next = sessionData(session.userId, session.familyId);
  const rotated = await db.$transaction(async tx => {
    await requireCurrentPasswordHash(tx, session.userId, session.user.passwordHash);
    const claimed = await tx.refreshSession.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (claimed.count !== 1) throw new AppError(401, 'Session already refreshed');
    return tx.refreshSession.create({ data: next.data });
  });
  return { accessToken: accessToken(session.userId, rotated.id), refreshToken: next.refreshToken, user: principal };
}
export async function logout(token?: string) {
  if (!token) return;
  const session = await db.refreshSession.findUnique({ where: { tokenHash: digest(token) } });
  if (session) await db.refreshSession.updateMany({ where: { familyId: session.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
}
export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!await verifyPassword(currentPassword, user.passwordHash)) throw new AppError(400, 'Current password is incorrect');
  const passwordHash = await hashPassword(newPassword);
  await db.$transaction(async tx => {
    await requireCurrentPasswordHash(tx, userId, user.passwordHash);
    await replacePassword(tx, userId, passwordHash, false);
    await audit(tx, userId, 'PASSWORD_CHANGED', 'user', userId);
  });
}

async function replacePassword(tx: Prisma.TransactionClient, userId: string, passwordHash: string, mustChangePassword: boolean) {
  await tx.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword }, select: { id: true } });
  await tx.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function resetPassword(userId: string, password: string, actorId: string) {
  const passwordHash = await hashPassword(password);
  await db.$transaction(async tx => {
    await replacePassword(tx, userId, passwordHash, true);
    await audit(tx, actorId, 'PASSWORD_RESET', 'user', userId);
  });
}
