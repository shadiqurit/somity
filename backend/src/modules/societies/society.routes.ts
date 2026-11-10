import { Router } from 'express';
import { requireSuperAdmin } from '../../middleware/auth.js';
import * as controller from './society.controller.js';
export const societyRouter = Router();
societyRouter.use(requireSuperAdmin);
societyRouter.get('/', controller.list);
societyRouter.post('/', controller.create);
societyRouter.put('/:id', controller.update);
