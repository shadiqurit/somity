import { Router } from 'express';
import { requirePermission } from '../../middleware/auth.js';
import * as controller from './note.controller.js';

export const noteRouter = Router();
noteRouter.get('/', requirePermission('notes.read'), controller.list);
noteRouter.post('/', requirePermission('notes.write'), controller.create);
noteRouter.put('/:id', requirePermission('notes.write'), controller.update);
noteRouter.delete('/:id', requirePermission('notes.delete'), controller.remove);
