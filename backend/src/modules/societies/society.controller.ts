import type { Request, Response } from 'express';
import * as service from './society.service.js';
import { createSocietySchema, updateSocietySchema, societyListSchema } from './society.validator.js';
export async function list(req: Request, res: Response) { const input = societyListSchema.parse(req.query); res.json(await service.list(input.page, input.search)); }
export async function create(req: Request, res: Response) { res.status(201).json(await service.create(createSocietySchema.parse(req.body), req.user.id)); }
export async function update(req: Request, res: Response) { res.json(await service.update(String(req.params.id), updateSocietySchema.parse(req.body), req.user.id)); }
