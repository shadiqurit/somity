import type { Request, Response } from 'express';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import * as service from './auth.service.js';
import { loginSchema, changePasswordSchema } from './auth.validator.js';
const cookieOptions = { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'strict' as const, path: '/api/auth', maxAge: 7 * 86400000 };
function sendSession(res: Response, result: Awaited<ReturnType<typeof service.login>>) {
  res.cookie('somity_refresh', result.refreshToken, cookieOptions).json({ accessToken: result.accessToken, user: result.user });
}
export function verifyOrigin(req: Request, _res: Response, next: () => void) {
  if (req.get('origin') !== env.FRONTEND_ORIGIN) throw new AppError(403, 'Untrusted request origin');
  next();
}
export async function login(req: Request, res: Response) {
  const input = loginSchema.parse(req.body);
  sendSession(res, await service.login(input.email, input.password));
}
export async function refresh(req: Request, res: Response) {
  const token = req.cookies?.somity_refresh;
  if (typeof token !== 'string' || token.length > 128) throw new AppError(401, 'Sign in required');
  sendSession(res, await service.refresh(token, req.get('X-Society-Id')));
}
export async function logout(req: Request, res: Response) {
  await service.logout(typeof req.cookies?.somity_refresh === 'string' ? req.cookies.somity_refresh : undefined);
  res.clearCookie('somity_refresh', cookieOptions).status(204).end();
}
export async function changePassword(req: Request, res: Response) {
  const input = changePasswordSchema.parse(req.body);
  await service.changePassword(req.user.id, input.currentPassword, input.newPassword);
  res.clearCookie('somity_refresh', cookieOptions).status(204).end();
}
