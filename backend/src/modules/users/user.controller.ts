import type { Request, Response } from 'express';
import { resetPassword } from '../auth/auth.service.js';
import { adminSchema, platformUserListSchema, setPasswordSchema, staffSchema, userIdSchema, userListSchema } from './user.validator.js';
import * as service from './user.service.js';
export async function list(req: Request, res: Response) { res.json(await service.list(userListSchema.parse(req.query).page, req.societyId)); }
export async function create(req: Request, res: Response) { res.status(201).json(await service.create(staffSchema.parse(req.body), req.user.id, req.societyId)); }

export async function listAll(req: Request, res: Response) {
  const { page, search } = platformUserListSchema.parse(req.query);
  res.json(await service.listAll(page, search));
}

export async function createAdmin(req: Request, res: Response) {
  res.status(201).json(await service.createAdmin(adminSchema.parse(req.body), req.user.id));
}

export async function setPassword(req: Request, res: Response) {
  const userId = userIdSchema.parse(req.params.id);
  const { password } = setPasswordSchema.parse(req.body);
  await resetPassword(userId, password, req.user.id);
  res.status(204).end();
}
