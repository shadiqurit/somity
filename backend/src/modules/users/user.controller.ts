import type { Request, Response } from 'express';
import { staffSchema, userListSchema } from './user.validator.js';
import * as service from './user.service.js';
export async function list(req: Request, res: Response) { res.json(await service.list(userListSchema.parse(req.query).page, req.societyId)); }
export async function create(req: Request, res: Response) { res.status(201).json(await service.create(staffSchema.parse(req.body), req.user.id, req.societyId)); }
