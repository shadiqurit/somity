import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../config/database.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { canSignIn, publicUser, userInclude } from '../modules/auth/auth.service.js';

export type Principal = Awaited<ReturnType<typeof publicUser>>;
declare global { namespace Express { interface Request { user: Principal; societyId: string; } } }
export const authenticate: RequestHandler = async (req, _res, next) => {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new AppError(401, 'Sign in required');
  let payload: jwt.JwtPayload;
  try {
    const value = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: 'somity-api', audience: 'somity-web' });
    if (typeof value === 'string' || !value.sub || typeof value.sid !== 'string') throw new Error();
    payload = value;
  } catch { throw new AppError(401, 'Access token expired or invalid'); }
  const session = await db.refreshSession.findUnique({ where: { id: payload.sid as string }, include: { user: { include: userInclude } } });
  if (!session || session.userId !== payload.sub || session.revokedAt || session.expiresAt <= new Date() || !canSignIn(session.user)) throw new AppError(401, 'Session no longer active');
  const societyId = req.get('X-Society-Id');
  if (societyId && (societyId.length > 30 || !/^[a-zA-Z0-9_-]+$/.test(societyId))) throw new AppError(400, 'Invalid society selection');
  req.user = await publicUser(session.user, societyId);
  next();
};
export const requirePasswordChanged: RequestHandler = (req, _res, next) => {
  if (req.user.mustChangePassword) throw new AppError(403, 'Change your temporary password first');
  next();
};
export function hasPermission(user: Pick<Principal, 'permissions'>, permission: string) { return user.permissions.includes(permission); }
export function requirePermission(permission: string): RequestHandler {
  return (req, _res, next) => {
    if (!hasPermission(req.user, permission)) throw new AppError(403, 'You do not have permission to do this');
    next();
  };
}
export function canViewMember(user: Pick<Principal, 'permissions' | 'memberId'>, memberId: string) {
  return hasPermission(user, 'members.read') || (hasPermission(user, 'profile.read') && user.memberId === memberId);
}

export const requireSociety: RequestHandler = (req, _res, next) => {
  if (!req.get('X-Society-Id')) throw new AppError(400, 'Select a society using X-Society-Id');
  if (!req.user.societyId) throw new AppError(403, 'Choose an active society to continue');
  req.societyId = req.user.societyId;
  next();
};
export const requireSuperAdmin: RequestHandler = (req, _res, next) => {
  if (!req.user.isSuperAdmin) throw new AppError(403, 'Only Super Admin can manage societies');
  next();
};
