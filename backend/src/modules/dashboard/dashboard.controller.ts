import type { Request, Response } from 'express';
import { summary } from './dashboard.service.js';
export async function get(req: Request, res: Response) { res.json(await summary(req.societyId)); }
