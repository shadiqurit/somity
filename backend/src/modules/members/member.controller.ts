import type { Request, Response } from 'express';
import { AppError } from '../../utils/errors.js';
import { canViewMember } from '../../middleware/auth.js';
import { auditView } from '../../services/audit.js';
import { submitSettlementPayment } from '../finance/finance.service.js';
import { memberDuesStatement } from '../finance/finance.member-statement.js';
import { idSchema, keySchema, settlementPaymentSchema, statementListSchema } from '../finance/finance.validator.js';
import * as service from './member.service.js';
import { archiveSchema, listSchema, memberLoginSchema, memberSchema, updateMemberSchema } from './member.validator.js';
export async function list(req: Request, res: Response) { res.json(await service.list(listSchema.parse(req.query), req.societyId)); }
async function viewProfile(req: Request, res: Response, id: string) {
  const member = await service.get(id, req.societyId);
  await auditView(req.user.id, req.societyId, 'MEMBER_PROFILE_VIEWED', 'member', id);
  res.json(member);
}
export async function get(req: Request, res: Response) {
  const id = String(req.params.id);
  if (!canViewMember(req.user, id)) throw new AppError(403, 'You may only view your own profile');
  await viewProfile(req, res, id);
}
export async function me(req: Request, res: Response) {
  if (!req.user.memberId) throw new AppError(404, 'No member profile is linked to this account');
  await viewProfile(req, res, req.user.memberId);
}
export async function create(req: Request, res: Response) { res.status(201).json(await service.create(memberSchema.parse(req.body), req.user.id, req.societyId)); }
export async function update(req: Request, res: Response) { res.json(await service.update(String(req.params.id), updateMemberSchema.parse(req.body), req.user.id, req.societyId)); }
export async function archive(req: Request, res: Response) {
  await service.archive(String(req.params.id), archiveSchema.parse(req.body).version, req.user.id, req.societyId);
  res.status(204).end();
}
export async function createLogin(req: Request, res: Response) {
  const input = memberLoginSchema.parse(req.body);
  res.status(201).json(await service.createLogin(String(req.params.id), input.email, input.password, req.user.id, req.societyId));
}

export async function getSettlement(req: Request, res: Response) {
  res.json(await service.settlement(req.societyId, idSchema.parse(req.params.id)));
}

export async function getSettlementStatement(req: Request, res: Response) {
  const memberId = idSchema.parse(req.params.id);
  const statement = await memberDuesStatement(req.societyId, memberId, statementListSchema.parse(req.query));
  await auditView(req.user.id, req.societyId, 'MEMBER_DUES_STATEMENT_VIEWED', 'member', memberId);
  res.json(statement);
}

export async function startSettlement(req: Request, res: Response) {
  res.json(await service.startSettlement(req.societyId, idSchema.parse(req.params.id), req.user.id));
}

export async function recordSettlementPayment(req: Request, res: Response) {
  const payment = await submitSettlementPayment(
    req.societyId, req.user.id, idSchema.parse(req.params.id),
    settlementPaymentSchema.parse(req.body), keySchema.parse(req.get('Idempotency-Key')),
  );
  res.status(201).json(payment);
}

export async function closeSettlement(req: Request, res: Response) {
  res.json(await service.closeSettlement(req.societyId, idSchema.parse(req.params.id), req.user.id));
}
