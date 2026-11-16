import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requirePermission, requireSociety, requireSuperAdmin } from '../../middleware/auth.js';
import { list } from './activity.service.js';

const filters = z.object({
  after: z.string().regex(/^[a-zA-Z0-9_-]{1,30}$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  action: z.string().regex(/^[A-Z_]{1,80}$/).optional(),
  actorRole: z.string().regex(/^[A-Z_]{1,40}$/).optional(),
});

const society: RequestHandler = async (req, res) => {
  res.json(await list({ societyId: req.societyId }, filters.parse(req.query)));
};
const mine: RequestHandler = async (req, res) => {
  const scope = req.user.societyId ? { OR: [{ societyId: req.user.societyId }, { societyId: null }] } : { societyId: null };
  res.json(await list({ ...scope, actorId: req.user.id }, filters.parse(req.query)));
};
const platform: RequestHandler = async (req, res) => {
  res.json(await list({}, filters.parse(req.query)));
};

export const activityRouter = Router();
activityRouter.get('/', requireSociety, requirePermission('activity.read'), society);
activityRouter.get('/me', mine);
activityRouter.get('/platform', requireSuperAdmin, platform);
