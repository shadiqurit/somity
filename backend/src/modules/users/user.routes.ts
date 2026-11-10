import { Router } from 'express';
import { requirePermission } from '../../middleware/auth.js';
import * as controller from './user.controller.js';
export const userRouter = Router();
userRouter.use(requirePermission('users.manage'));
userRouter.get('/', controller.list);
userRouter.post('/', controller.create);
