import type { Request, Response } from 'express';
import { AppError } from '../../utils/errors.js';
import { canViewMember } from '../../middleware/auth.js';
import * as service from './member.service.js';
import { archiveSchema, listSchema, memberLoginSchema, memberSchema, updateMemberSchema } from './member.validator.js';
export async function list(req: Request, res: Response) { res.json(await service.list(listSchema.parse(req.query), req.societyId)); }
export async function get(req: Request, res: Response) {
  const id = String(req.params.id);
  if (!canViewMember(req.user, id)) throw new AppError(403, 'You may only view your own profile');
  res.json(await service.get(id, req.societyId));
}
export async function me(req: Request, res: Response) {
  if (!req.user.memberId) throw new AppError(404, 'No member profile is linked to this account');
  res.json(await service.get(req.user.memberId, req.societyId));
}
export async function create(req: Request, res: Response) { res.status(201).json(await service.create(memberSchema.parse(req.body), req.user.id, req.societyId)); }
export async function update(req: Request, res: Response) { res.json(await service.update(String(req.params.id), updateMemberSchema.parse(req.body), req.user.id, req.societyId)); }
export async function archive(req: Request, res: Response) {
  await service.archive(String(req.params.id), archiveSchema.parse(req.body).version, req.user.id, req.societyId);
  res.status(204).end();
}
export async function createLogin(req: Request, res: Response) {
  const input = memberLoginSchema.parse(req.body);
  res.status(201).json(await service.createLogin(String(req.params.id), input.email, input.password, req.user.id, req.societyId));
}
