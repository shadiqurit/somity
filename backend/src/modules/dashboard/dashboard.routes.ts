import { Router } from 'express';
import { requirePermission } from '../../middleware/auth.js';
import * as controller from './dashboard.controller.js';
export const dashboardRouter = Router();
dashboardRouter.get('/', requirePermission('dashboard.read'), controller.get);
