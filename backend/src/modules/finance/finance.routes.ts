import { Router } from 'express';
import { requirePermission } from '../../middleware/auth.js';
import * as controller from './finance.controller.js';
export const financeRouter = Router();
financeRouter.get('/statements/me', requirePermission('profile.read'), controller.ownStatement);
financeRouter.get('/statements/:memberId', requirePermission('finance.read'), controller.statement);
financeRouter.get('/summary', requirePermission('finance.read'), controller.summary);
financeRouter.get('/ledger', requirePermission('finance.read'), controller.ledger);
financeRouter.get('/accounts', requirePermission('finance.read'), controller.accounts);
financeRouter.post('/accounts', requirePermission('finance.settings'), controller.createAccount);
financeRouter.get('/policy', requirePermission('finance.read'), controller.policy);
financeRouter.put('/policy', requirePermission('finance.settings'), controller.updatePolicy);
financeRouter.get('/transactions', requirePermission('finance.read'), controller.list);
financeRouter.post('/transactions', requirePermission('finance.write'), controller.submit);
financeRouter.get('/transactions/:id', requirePermission('finance.read'), controller.get);
financeRouter.post('/transactions/:id/decision', requirePermission('finance.approve'), controller.decide);
financeRouter.post('/transactions/:id/cancel', requirePermission('finance.write'), controller.cancel);
financeRouter.post('/transactions/:id/reversal', requirePermission('finance.write'), controller.reverse);

