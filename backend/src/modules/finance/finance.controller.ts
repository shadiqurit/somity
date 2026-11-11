import type { RequestHandler } from 'express';
import * as service from './finance.service.js';
import * as reports from './finance.reports.js';
import { accountSchema, decisionSchema, idSchema, keySchema, listSchema, policySchema, reversalSchema, transactionSchema, dateRangeSchema } from './finance.validator.js';
import { AppError } from '../../utils/errors.js';

const id = (value: unknown) => idSchema.parse(value);
export const accounts: RequestHandler = async (req, res) => { res.json(await service.accounts(req.societyId)); };
export const createAccount: RequestHandler = async (req, res) => { res.status(201).json(await service.createAccount(req.societyId, req.user.id, accountSchema.parse(req.body))); };
export const policy: RequestHandler = async (req, res) => { res.json(await service.policy(req.societyId)); };
export const updatePolicy: RequestHandler = async (req, res) => { res.json(await service.updatePolicy(req.societyId, req.user.id, policySchema.parse(req.body))); };
export const list: RequestHandler = async (req, res) => { res.json(await service.list(req.societyId, listSchema.parse(req.query))); };
export const get: RequestHandler = async (req, res) => { res.json(await service.get(req.societyId, id(req.params.id))); };
export const submit: RequestHandler = async (req, res) => { res.status(201).json(await service.submit(req.societyId, req.user.id, transactionSchema.parse(req.body), keySchema.parse(req.get('Idempotency-Key')))); };
export const reverse: RequestHandler = async (req, res) => { res.status(201).json(await service.requestReversal(req.societyId, req.user.id, id(req.params.id), reversalSchema.parse(req.body), keySchema.parse(req.get('Idempotency-Key')))); };
export const decide: RequestHandler = async (req, res) => { res.json(await service.decide(req.societyId, req.user.id, id(req.params.id), decisionSchema.parse(req.body))); };
export const cancel: RequestHandler = async (req, res) => { res.json(await service.cancel(req.societyId, req.user.id, id(req.params.id))); };
export const statement: RequestHandler = async (req, res) => { res.json(await service.statement(req.societyId, id(req.params.memberId), listSchema.parse(req.query))); };
export const ownStatement: RequestHandler = async (req, res) => {
  if (!req.user.memberId) throw new AppError(404, 'No member profile is linked to this account');
  res.json(await service.statement(req.societyId, req.user.memberId, listSchema.parse(req.query)));
};
export const summary: RequestHandler = async (req, res) => { res.json(await service.summary(req.societyId, dateRangeSchema.parse(req.query))); };
export const ledger: RequestHandler = async (req, res) => { res.json(await service.ledger(req.societyId, listSchema.parse(req.query))); };
export const loans: RequestHandler = async (req, res) => { res.json(await reports.loans(req.societyId, listSchema.parse(req.query), undefined, req.params.id ? id(req.params.id) : undefined)); };
export const ownLoans: RequestHandler = async (req, res) => {
  if (!req.user.memberId) throw new AppError(404, 'No member profile linked');
  res.json(await reports.loans(req.societyId, listSchema.parse(req.query), req.user.memberId, req.params.id ? id(req.params.id) : undefined));
};
export const investments: RequestHandler = async (req, res) => { res.json(await reports.investments(req.societyId, listSchema.parse(req.query), req.params.id ? id(req.params.id) : undefined)); };
export const bankSummary: RequestHandler = async (req, res) => { res.json(await reports.bankSummary(req.societyId, dateRangeSchema.parse(req.query))); };

