import type { Request, Response } from 'express';
import * as service from './note.service.js';
import { noteBodySchema, noteListSchema } from './note.validator.js';

export async function list(req: Request, res: Response) {
  res.json(await service.list(req.societyId, noteListSchema.parse(req.query)));
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await service.create(req.societyId, noteBodySchema.parse(req.body), req.user.id));
}

export async function update(req: Request, res: Response) {
  res.json(await service.update(req.societyId, String(req.params.id), noteBodySchema.parse(req.body), req.user.id));
}

export async function remove(req: Request, res: Response) {
  res.json(await service.remove(req.societyId, String(req.params.id), req.user.id));
}
