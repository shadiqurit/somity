import type { Request, RequestHandler, Response } from 'express';
import * as service from './finance.service.js';
import * as reports from './finance.reports.js';
import { accountSchema, decisionSchema, idSchema, keySchema, listSchema, policySchema, reversalSchema, transactionSchema, dateRangeSchema, transactionLogSchema } from './finance.validator.js';
import { AppError } from '../../utils/errors.js';
import { auditView } from '../../services/audit.js';

const id = (value: unknown) => idSchema.parse(value);
export const accounts: RequestHandler = async (req, res) => { res.json(await service.accounts(req.societyId)); };
export const createAccount: RequestHandler = async (req, res) => { res.status(201).json(await service.createAccount(req.societyId, req.user.id, accountSchema.parse(req.body))); };
export const policy: RequestHandler = async (req, res) => { res.json(await service.policy(req.societyId)); };
export const updatePolicy: RequestHandler = async (req, res) => { res.json(await service.updatePolicy(req.societyId, req.user.id, policySchema.parse(req.body))); };
export const list: RequestHandler = async (req, res) => { res.json(await service.list(req.societyId, listSchema.parse(req.query))); };
export const transactionLog: RequestHandler = async (req, res) => { res.json(await service.transactionLog(req.societyId, transactionLogSchema.parse(req.query))); };
export const get: RequestHandler = async (req, res) => {
  const transaction = await service.get(req.societyId, id(req.params.id));
  await auditView(req.user.id, req.societyId, 'FINANCE_TRANSACTION_VIEWED', 'transaction', transaction.id);
  res.json(transaction);
};
export const remove: RequestHandler = async (req, res) => { await service.removeRejected(req.societyId, req.user.id, id(req.params.id)); res.status(204).end(); };
export const submit: RequestHandler = async (req, res) => { res.status(201).json(await service.submit(req.societyId, req.user.id, transactionSchema.parse(req.body), keySchema.parse(req.get('Idempotency-Key')))); };
export const reverse: RequestHandler = async (req, res) => { res.status(201).json(await service.requestReversal(req.societyId, req.user.id, id(req.params.id), reversalSchema.parse(req.body), keySchema.parse(req.get('Idempotency-Key')))); };
export const decide: RequestHandler = async (req, res) => { res.json(await service.decide(req.societyId, req.user.id, id(req.params.id), decisionSchema.parse(req.body))); };
export const cancel: RequestHandler = async (req, res) => { res.json(await service.cancel(req.societyId, req.user.id, id(req.params.id))); };
async function viewStatement(req: Request, res: Response, memberId: string) {
  const statement = await service.statement(req.societyId, memberId, listSchema.parse(req.query));
  await auditView(req.user.id, req.societyId, 'FINANCE_STATEMENT_VIEWED', 'member', memberId);
  res.json(statement);
}
export const statement: RequestHandler = async (req, res) => { await viewStatement(req, res, id(req.params.memberId)); };
export const ownStatement: RequestHandler = async (req, res) => {
  if (!req.user.memberId) throw new AppError(404, 'No member profile is linked to this account');
  await viewStatement(req, res, req.user.memberId);
};
export const summary: RequestHandler = async (req, res) => { res.json(await service.summary(req.societyId, dateRangeSchema.parse(req.query))); };
export const ledger: RequestHandler = async (req, res) => {
  const ledger = await service.ledger(req.societyId, listSchema.parse(req.query));
  await auditView(req.user.id, req.societyId, 'FINANCE_LEDGER_VIEWED', 'ledger', req.societyId);
  res.json(ledger);
};
export const loans: RequestHandler = async (req, res) => {
  const loanId = req.params.id ? id(req.params.id) : undefined;
  const loans = await reports.loans(req.societyId, listSchema.parse(req.query), undefined, loanId);
  if (loanId) await auditView(req.user.id, req.societyId, 'FINANCE_LOAN_VIEWED', 'loan', loanId);
  res.json(loans);
};
export const ownLoans: RequestHandler = async (req, res) => {
  if (!req.user.memberId) throw new AppError(404, 'No member profile linked');
  const loanId = req.params.id ? id(req.params.id) : undefined;
  const loans = await reports.loans(req.societyId, listSchema.parse(req.query), req.user.memberId, loanId);
  if (loanId) await auditView(req.user.id, req.societyId, 'FINANCE_LOAN_VIEWED', 'loan', loanId);
  else await auditView(req.user.id, req.societyId, 'FINANCE_LOANS_VIEWED', 'member', req.user.memberId);
  res.json(loans);
};
export const investments: RequestHandler = async (req, res) => {
  const investmentId = req.params.id ? id(req.params.id) : undefined;
  const investments = await reports.investments(req.societyId, listSchema.parse(req.query), investmentId);
  if (investmentId) await auditView(req.user.id, req.societyId, 'FINANCE_INVESTMENT_VIEWED', 'investment', investmentId);
  res.json(investments);
};
export const loanSummary: RequestHandler = async (req, res) => { res.json(await reports.loanSummary(req.societyId)); };
export const investmentSummary: RequestHandler = async (req, res) => { res.json(await reports.investmentSummary(req.societyId)); };
export const bankSummary: RequestHandler = async (req, res) => { res.json(await reports.bankSummary(req.societyId, dateRangeSchema.parse(req.query))); };
export const expenseSummary: RequestHandler = async (req, res) => { res.json(await reports.expenseSummary(req.societyId, dateRangeSchema.parse(req.query))); };
export const incomeSummary: RequestHandler = async (req, res) => { res.json(await reports.incomeSummary(req.societyId, dateRangeSchema.parse(req.query))); };

