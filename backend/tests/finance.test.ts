import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../src/utils/password.js';
import { syncRoles } from '../src/services/roles.js';

const local = parse(readFileSync(new URL('../.env', import.meta.url)));
const url = process.env.TEST_DATABASE_URL ?? local.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Financial tests require a separate _test database');
process.env.DATABASE_URL = url;
const { app } = await import('../src/app.js');
const { db } = await import('../src/config/database.js');
const tag = randomUUID().slice(0, 8); const password = 'FinanceTestPassword123'; const origin = 'http://localhost:5173';
const societies: string[] = []; const users: string[] = []; const tokens: Record<string, string> = {}; const userIds: Record<string, string> = {};
let societyId = ''; let otherSocietyId = ''; let memberId = ''; let secondMemberId = ''; let cashId = ''; let otherCashId = ''; let depositId = '';
const headers = (role: string, sid = societyId) => ({ Authorization: `Bearer ${tokens[role]}`, 'X-Society-Id': sid, Origin: origin });
const input = (type = 'DEPOSIT', amount = '100.25', effectiveDate = '2026-11-09', accountId = cashId, mid = memberId) => ({ type, amount, effectiveDate, cashAccountId: accountId, memberId: mid, reference: '', note: '' });
async function submit(data = input(), key = randomUUID()) { return request(app).post('/api/finance/transactions').set(headers('ACCOUNTANT')).set('Idempotency-Key', key).send(data); }
async function approve(id: string, role = 'APPROVER') { return request(app).post(`/api/finance/transactions/${id}/decision`).set(headers(role)).send({ decision: 'APPROVE' }); }
async function balance() { return (await request(app).get(`/api/finance/statements/${memberId}`).set(headers('ADMIN')).expect(200)).body.closingBalance; }
async function setPolicy(requiredApprovals: number, allowSelfApproval = false) {
  const { body } = await request(app).get('/api/finance/policy').set(headers('ADMIN')).expect(200);
  return request(app).put('/api/finance/policy').set(headers('ADMIN')).send({ version: body.version, requiredApprovals, allowSelfApproval }).expect(200);
}
beforeAll(async () => {
  await db.$transaction(tx => syncRoles(tx));
  for (const suffix of ['A', 'B']) {
    const society = await db.society.create({ data: { code: `FIN-${suffix}-${tag}`, name: `Finance ${suffix} ${tag}` } }); societies.push(society.id);
    if (suffix === 'A') societyId = society.id; else otherSocietyId = society.id;
  }
  const passwordHash = await hashPassword(password);
  for (const roleCode of ['SUPER_ADMIN', 'ADMIN', 'SOCIETY_ADMIN', 'ACCOUNTANT', 'APPROVER', 'MEMBER']) {
    const role = await db.role.findUniqueOrThrow({ where: { code: roleCode } });
    const user = await db.user.create({ data: {
      name: `Finance ${roleCode}`, email: `${tag}-${roleCode.toLowerCase()}@finance.test`, passwordHash, mustChangePassword: false,
      ...(['SUPER_ADMIN', 'ADMIN'].includes(roleCode) ? { roles: { create: { roleId: role.id } } } : { memberships: { create: { societyId, roleId: role.id } } }),
    } });
    users.push(user.id); userIds[roleCode] = user.id;
    tokens[roleCode] = (await request(app).post('/api/auth/login').set('Origin', origin).send({ email: user.email, password }).expect(200)).body.accessToken;
  }
  memberId = (await db.member.create({ data: { societyId, memberNo: `FIN-${tag}`, fullName: 'Finance Member', phone: '01700000000', address: 'Dhaka', joinedAt: new Date('2026-01-01'), userId: userIds.MEMBER } })).id;
  secondMemberId = (await db.member.create({ data: { societyId, memberNo: `FIN-2-${tag}`, fullName: 'Other Finance Member', phone: '01700000000', address: 'Dhaka', joinedAt: new Date('2026-01-01') } })).id;
  cashId = (await request(app).post('/api/finance/accounts').set(headers('ADMIN')).send({ code: 'CASH-01', name: 'Main cash', kind: 'CASH' }).expect(201)).body.id;
  otherCashId = (await request(app).post('/api/finance/accounts').set(headers('ADMIN', otherSocietyId)).send({ code: 'CASH-01', name: 'Other cash', kind: 'CASH' }).expect(201)).body.id;
});
afterAll(async () => {
  const scoped = { societyId: { in: societies } };
  await db.ledgerEntry.deleteMany({ where: scoped });
  await db.approvalDecision.deleteMany({ where: scoped });
  await db.financialTransaction.updateMany({ where: scoped, data: { loanId: null, investmentId: null } });
  await db.loan.deleteMany({ where: scoped });
  await db.investment.deleteMany({ where: scoped });
  await db.financialTransaction.deleteMany({ where: { ...scoped, type: 'REVERSAL' } });
  await db.financialTransaction.deleteMany({ where: scoped });
  await db.nonMemberBorrower.deleteMany({ where: scoped });
  await db.memberSettlement.deleteMany({ where: scoped });
  await db.ledgerAccount.deleteMany({ where: scoped });
  await db.financePolicy.deleteMany({ where: scoped });
  await db.auditLog.deleteMany({ where: { OR: [scoped, { actorId: { in: users } }] } });
  await db.nominee.deleteMany({ where: scoped });
  await db.member.deleteMany({ where: scoped });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.society.deleteMany({ where: { id: { in: societies } } });
  await db.$disconnect();
});

describe('Phase 2 financial workflow', () => {
  it('enforces permissions, validation and mandatory society scope', async () => {
    await request(app).get('/api/finance/accounts').expect(401);
    await request(app).get('/api/finance/accounts').set({ Authorization: `Bearer ${tokens.ADMIN}` }).expect(400);
    await request(app).get('/api/finance/transactions').set(headers('MEMBER')).expect(403);
    await request(app).post('/api/finance/accounts').set(headers('ACCOUNTANT')).send({ code: 'BAD', name: 'Forbidden', kind: 'CASH' }).expect(403);
    await request(app).post('/api/finance/transactions').set(headers('APPROVER')).set('Idempotency-Key', randomUUID()).send(input()).expect(403);
    await request(app).post('/api/finance/transactions').set(headers('ACCOUNTANT')).send(input()).expect(422);
    for (const amount of ['0', '-1', '0.001', '1e3', 'abc', '1,000']) expect((await submit(input('DEPOSIT', amount))).status).toBe(422);
    expect((await submit(input('DEPOSIT', '1', '2099-01-01'))).status).toBe(422);
  });
  it('lets Admin submit transactions in another society while keeping Society Admin scoped', async () => {
    const transaction = { type: 'OTHER_INCOME', amount: '10.50', cashAccountId: otherCashId, effectiveDate: '2026-11-09', note: 'Society B income' };
    await request(app).post('/api/finance/transactions').set(headers('SOCIETY_ADMIN', otherSocietyId)).set('Idempotency-Key', randomUUID()).send(transaction).expect(403);
    const created = await request(app).post('/api/finance/transactions').set(headers('ADMIN', otherSocietyId)).set('Idempotency-Key', randomUUID()).send(transaction).expect(201);
    const path = `/api/finance/transactions/${created.body.id}`;
    await request(app).get(path).set(headers('ADMIN')).expect(404);
    await request(app).post(`${path}/decision`).set(headers('ADMIN', otherSocietyId)).send({ decision: 'APPROVE' }).expect(403);
    await request(app).post(`${path}/cancel`).set(headers('ADMIN', otherSocietyId)).expect(200);
    const local = await request(app).post('/api/finance/transactions').set(headers('SOCIETY_ADMIN')).set('Idempotency-Key', randomUUID()).send(input('DEPOSIT', '1')).expect(201);
    await request(app).post(`/api/finance/transactions/${local.body.id}/cancel`).set(headers('SOCIETY_ADMIN')).expect(200);
  });
  it('keeps pending transactions out of balances and handles submission retries safely', async () => {
    const key = randomUUID(); const [first, retry] = await Promise.all([submit(input(), key), submit(input(), key)]);
    expect(first.status).toBe(201); expect(retry.status).toBe(201); expect(first.body.id).toBe(retry.body.id); depositId = first.body.id;
    expect(await balance()).toBe('0.00');
    expect((await submit(input('DEPOSIT', '200'), key)).status).toBe(409);
    expect(await db.ledgerEntry.count({ where: { transactionId: depositId } })).toBe(0);
  });
  it('posts balanced exact-decimal entries once even with concurrent approval attempts', async () => {
    const replies = await Promise.all([approve(depositId), approve(depositId)]);
    expect(replies.map(r => r.status).sort()).toEqual([200, 409]);
    expect(await balance()).toBe('100.25');
    const lines = await db.ledgerEntry.findMany({ where: { transactionId: depositId } });
    expect(lines).toHaveLength(2); expect(lines[0]!.debit.plus(lines[1]!.debit).toFixed(2)).toBe('100.25');
    expect(lines[0]!.credit.plus(lines[1]!.credit).toFixed(2)).toBe('100.25');
    expect(await db.approvalDecision.count({ where: { transactionId: depositId } })).toBe(1);
  });
  it('blocks self-approval and snapshots policy when a request is submitted', async () => {
    const mine = await request(app).post('/api/finance/transactions').set(headers('ADMIN')).set('Idempotency-Key', randomUUID()).send(input('DEPOSIT', '10')).expect(201);
    await approve(mine.body.id, 'ADMIN').then(r => expect(r.status).toBe(403));
    await setPolicy(2);
    expect((await approve(mine.body.id)).body.status).toBe('POSTED');
    const pending = await submit(input('DEPOSIT', '0.10')); expect(pending.status).toBe(201);
    expect((await approve(pending.body.id)).body.status).toBe('PENDING');
    expect((await approve(pending.body.id)).status).toBe(409);
    expect(await balance()).toBe('110.25');
    expect((await approve(pending.body.id, 'ADMIN')).body.status).toBe('POSTED');
    expect(await balance()).toBe('110.35');
    await setPolicy(1);
  });
  it('rejection and requester cancellation leave no ledger entries', async () => {
    const rejected = await submit(input('DEPOSIT', '500'));
    await request(app).post(`/api/finance/transactions/${rejected.body.id}/decision`).set(headers('APPROVER')).send({ decision: 'REJECT' }).expect(422);
    await request(app).post(`/api/finance/transactions/${rejected.body.id}/decision`).set(headers('APPROVER')).send({ decision: 'REJECT', comment: 'Receipt is missing' }).expect(200);
    expect((await approve(rejected.body.id)).status).toBe(409);
    const cancelled = await submit(input('DEPOSIT', '600'));
    await request(app).post(`/api/finance/transactions/${cancelled.body.id}/cancel`).set(headers('ADMIN')).expect(403);
    await request(app).post(`/api/finance/transactions/${cancelled.body.id}/cancel`).set(headers('ACCOUNTANT')).expect(200);
    expect(await balance()).toBe('110.35');
    expect(await db.ledgerEntry.count({ where: { transactionId: { in: [rejected.body.id, cancelled.body.id] } } })).toBe(0);
  });
  it('prevents concurrent overspending and rolls back a failed final decision', async () => {
    const a = await submit(input('WITHDRAWAL', '80')); const b = await submit(input('WITHDRAWAL', '80'));
    const replies = await Promise.all([approve(a.body.id), approve(b.body.id)]);
    expect(replies.map(r => r.status).sort()).toEqual([200, 409]); expect(await balance()).toBe('30.35');
    const failed = replies[0]!.status === 409 ? a.body.id : b.body.id;
    expect(await db.approvalDecision.count({ where: { transactionId: failed } })).toBe(0);
    expect(await db.ledgerEntry.count({ where: { transactionId: failed } })).toBe(0);
    expect((await db.financialTransaction.findUniqueOrThrow({ where: { id: failed } })).status).toBe('PENDING');
  });
  it('does not allow a backdated withdrawal to create a negative historical balance', async () => {
    const backdated = await submit(input('WITHDRAWAL', '1', '2026-11-08'));
    expect((await approve(backdated.body.id)).status).toBe(409); expect(await balance()).toBe('30.35');
  });
  it('requires account funds as well as member savings', async () => {
    const bank = (await request(app).post('/api/finance/accounts').set(headers('ADMIN')).send({ code: 'BANK-01', name: 'Savings bank', kind: 'BANK', bankName: 'Local Bank', accountNumberLast4: '1234' }).expect(201)).body;
    const cashShort = await submit(input('WITHDRAWAL', '10', '2026-11-09', bank.id));
    expect((await approve(cashShort.body.id)).status).toBe(409); expect(await balance()).toBe('30.35');
  });
  it('isolates requests, accounts, statements, ledger and composite foreign keys by society', async () => {
    expect((await submit(input('DEPOSIT', '1', '2026-11-09', otherCashId))).status).toBe(404);
    await request(app).get(`/api/finance/transactions/${depositId}`).set(headers('ADMIN', otherSocietyId)).expect(404);
    await request(app).post(`/api/finance/transactions/${depositId}/decision`).set(headers('ADMIN', otherSocietyId)).send({ decision: 'APPROVE' }).expect(404);
    await request(app).get(`/api/finance/statements/${memberId}`).set(headers('ADMIN', otherSocietyId)).expect(404);
    expect((await request(app).get('/api/finance/ledger').set(headers('ADMIN', otherSocietyId)).expect(200)).body.total).toBe(0);
    await expect(db.ledgerEntry.create({ data: { societyId: otherSocietyId, transactionId: depositId, line: 3, accountId: otherCashId, memberId, debit: '1', credit: '0' } })).rejects.toMatchObject({ code: 'P2003' });
    await expect(db.ledgerEntry.create({ data: { societyId, transactionId: depositId, line: 3, accountId: cashId, memberId, debit: '1', credit: '1' } })).rejects.toThrow();
  });
  it('only reverses through approval, preserves originals and prevents duplicate reversals', async () => {
    const original = await submit(input('DEPOSIT', '12.34')); expect((await approve(original.body.id)).status).toBe(200);
    const endpoint = `/api/finance/transactions/${original.body.id}/reversal`;
    const key = randomUUID(); const body = { effectiveDate: '2026-11-09', note: 'Incorrect deposit receipt' };
    const reversal = await request(app).post(endpoint).set(headers('ACCOUNTANT')).set('Idempotency-Key', key).send(body).expect(201);
    const retry = await request(app).post(endpoint).set(headers('ACCOUNTANT')).set('Idempotency-Key', key).send(body).expect(201); expect(retry.body.id).toBe(reversal.body.id);
    await request(app).post(endpoint).set(headers('ACCOUNTANT')).set('Idempotency-Key', randomUUID()).send(body).expect(409);
    expect(await balance()).toBe('42.69'); expect((await approve(reversal.body.id)).body.status).toBe('POSTED'); expect(await balance()).toBe('30.35');
    expect((await db.financialTransaction.findUniqueOrThrow({ where: { id: original.body.id } })).status).toBe('POSTED');
    expect(await db.ledgerEntry.count({ where: { transactionId: original.body.id } })).toBe(2);
    await request(app).post(`/api/finance/transactions/${reversal.body.id}/reversal`).set(headers('ACCOUNTANT')).set('Idempotency-Key', randomUUID()).send(body).expect(409);
    const cannotReverseSpentDeposit = await request(app).post(`/api/finance/transactions/${depositId}/reversal`).set(headers('ACCOUNTANT')).set('Idempotency-Key', randomUUID()).send(body).expect(201);
    expect((await approve(cannotReverseSpentDeposit.body.id)).status).toBe(409); expect(await balance()).toBe('30.35');
  });
  it('members can see only their own approved statement with exact totals and date filters', async () => {
    const statement = await request(app).get('/api/finance/statements/me').set(headers('MEMBER')).expect(200);
    expect(statement.body.closingBalance).toBe('30.35'); expect(statement.body.member.memberNo).toBe(`FIN-${tag}`);
    await request(app).get(`/api/finance/statements/${secondMemberId}`).set(headers('MEMBER')).expect(403);
    const before = await request(app).get(`/api/finance/statements/${memberId}`).query({ to: '2026-11-08' }).set(headers('ADMIN')).expect(200);
    expect(before.body.closingBalance).toBe('0.00'); expect(before.body.total).toBe(0);
    const after = await request(app).get(`/api/finance/statements/${memberId}`).query({ from: '2026-11-10', pageSize: 1 }).set(headers('ADMIN')).expect(200);
    expect(after.body.openingBalance).toBe('30.35'); expect(after.body.total).toBe(0);
    const paged = await request(app).get(`/api/finance/statements/${memberId}`).query({ pageSize: 1, page: 2 }).set(headers('ADMIN')).expect(200);
    expect(paged.body.items).toHaveLength(1); expect(paged.body.items[0].balance).toBe('110.25');
    await request(app).get('/api/finance/summary').query({ from: '2026-11-10', to: '2026-11-09' }).set(headers('ADMIN')).expect(422);
    const accounts = (await request(app).get('/api/finance/accounts').set(headers('ADMIN')).expect(200)).body;
    expect(accounts.find((a: { id: string }) => a.id === cashId).balance).toBe('30.35');
    const events = await db.auditLog.findMany({ where: { societyId, entityId: depositId } });
    expect(events.map(e => e.action)).toEqual(expect.arrayContaining(['FINANCE_REQUESTED', 'FINANCE_APPROVED', 'FINANCE_POSTED']));
  });
  it('supports explicitly enabled self-approval and rejects stale policy changes', async () => {
    const current = (await setPolicy(1, true)).body;
    await request(app).put('/api/finance/policy').set(headers('ADMIN')).send({ version: current.version - 1, requiredApprovals: 2, allowSelfApproval: false }).expect(409);
    const mine = await request(app).post('/api/finance/transactions').set(headers('ADMIN')).set('Idempotency-Key', randomUUID()).send(input('DEPOSIT', '1.01')).expect(201);
    expect((await approve(mine.body.id, 'ADMIN')).body.status).toBe('POSTED'); expect(await balance()).toBe('31.36');
    const reversal = await request(app).post(`/api/finance/transactions/${mine.body.id}/reversal`).set(headers('ADMIN')).set('Idempotency-Key', randomUUID()).send({ effectiveDate: '2026-11-09', note: 'Reverse self approval test' }).expect(201);
    expect((await approve(reversal.body.id, 'ADMIN')).body.status).toBe('POSTED'); expect(await balance()).toBe('30.35');
    await setPolicy(1);
  });
  it('rejects inactive members at final posting and leaves the request pending', async () => {
    const pending = await submit(input('DEPOSIT', '3', '2026-11-09', cashId, secondMemberId));
    await db.member.update({ where: { id: secondMemberId }, data: { status: 'SUSPENDED' } });
    expect((await approve(pending.body.id)).status).toBe(409);
    expect(await db.approvalDecision.count({ where: { transactionId: pending.body.id } })).toBe(0);
    await db.member.update({ where: { id: secondMemberId }, data: { status: 'ACTIVE' } });
    await request(app).post(`/api/finance/transactions/${pending.body.id}/cancel`).set(headers('ACCOUNTANT')).expect(200);
  });
  it('can reverse a withdrawal and rejects a two-stage request without posting', async () => {
    const withdrawal = await submit(input('WITHDRAWAL', '2.02')); expect((await approve(withdrawal.body.id)).body.status).toBe('POSTED'); expect(await balance()).toBe('28.33');
    const reversal = await request(app).post(`/api/finance/transactions/${withdrawal.body.id}/reversal`).set(headers('ACCOUNTANT')).set('Idempotency-Key', randomUUID()).send({ effectiveDate: '2026-11-09', note: 'Withdrawal was cancelled' }).expect(201);
    expect((await approve(reversal.body.id)).body.status).toBe('POSTED'); expect(await balance()).toBe('30.35');
    await setPolicy(2);
    const rejected = await submit(input('DEPOSIT', '9.99')); expect((await approve(rejected.body.id)).body.status).toBe('PENDING');
    await request(app).post(`/api/finance/transactions/${rejected.body.id}/decision`).set(headers('ADMIN')).send({ decision: 'REJECT', comment: 'Second review rejected receipt' }).expect(200);
    expect(await db.ledgerEntry.count({ where: { transactionId: rejected.body.id } })).toBe(0); expect(await balance()).toBe('30.35');
    await setPolicy(1);
  });
  it('posts loans, installments, investment principal/profit, expenses and bank transfers through approval', async () => {
    const send = async (data: Record<string, unknown>) => request(app).post('/api/finance/transactions').set(headers('ACCOUNTANT')).set('Idempotency-Key', randomUUID()).send({ effectiveDate: '2026-11-09', cashAccountId: cashId, ...data }).expect(201);
    const loanSummary = async (sid = societyId) => (await request(app).get('/api/finance/loan-summary').set(headers('ADMIN', sid)).expect(200)).body;
    const investmentSummary = async (sid = societyId) => (await request(app).get('/api/finance/investment-summary').set(headers('ADMIN', sid)).expect(200)).body;
    const expenseSummary = async (query: { from?: string; to?: string } = {}, sid = societyId) =>
      (await request(app).get('/api/finance/expense-summary').set(headers('ADMIN', sid)).query(query).expect(200)).body;
    const fund = await submit(input('DEPOSIT', '1000')); expect((await approve(fund.body.id)).status).toBe(200);
    const pending = await send({ type: 'LOAN_DISBURSEMENT', memberId, amount: '100.01', installmentCount: 3, firstDueDate: '2027-01-31' });
    expect(await db.loan.count({ where: { societyId } })).toBe(0);
    expect(await loanSummary()).toEqual({ disbursed: '0.00', repaid: '0.00', outstanding: '0.00', pending: 1 });
    const disbursement = await approve(pending.body.id); expect(disbursement.status).toBe(200); const loanId = disbursement.body.loanId;
    const loan = await request(app).get(`/api/finance/loans/${loanId}`).set(headers('ADMIN')).expect(200);
    expect(loan.body.outstanding).toBe('100.01'); expect(loan.body.installments.map((r: { amount: string }) => r.amount)).toEqual(['33.33','33.33','33.35']);
    const repayment = await send({ type: 'LOAN_REPAYMENT', loanId, amount: '20.01' }); expect((await approve(repayment.body.id)).status).toBe(200);
    expect((await request(app).get(`/api/finance/loans/${loanId}`).set(headers('ADMIN')).expect(200)).body.outstanding).toBe('80.00');
    expect(await loanSummary()).toEqual({ disbursed: '100.01', repaid: '20.01', outstanding: '80.00', pending: 0 });
    expect(await loanSummary(otherSocietyId)).toEqual({ disbursed: '0.00', repaid: '0.00', outstanding: '0.00', pending: 0 });
    await request(app).get('/api/finance/loan-summary').set(headers('MEMBER')).expect(403);
    const tooMuch = await send({ type: 'LOAN_REPAYMENT', loanId, amount: '81' }); expect((await approve(tooMuch.body.id)).status).toBe(409);
    const investment = await send({ type: 'INVESTMENT_PURCHASE', amount: '200', title: 'Test partnership', counterparty: 'Test business' });
    expect(await investmentSummary()).toEqual({ invested: '0.00', principalReturned: '0.00', outstanding: '0.00', profit: '0.00' });
    const purchase = await approve(investment.body.id); expect(purchase.status).toBe(200); const investmentId = purchase.body.investmentId;
    await request(app).post('/api/finance/transactions').set(headers('ACCOUNTANT')).set('Idempotency-Key', randomUUID()).send({ type:'INVESTMENT_RETURN', investmentId, cashAccountId:cashId, effectiveDate:'2026-11-09', amount:'61', principalReturned:'50', profit:'10' }).expect(422);
    const returned = await send({ type: 'INVESTMENT_RETURN', investmentId, amount: '60', principalReturned: '50', profit: '10' }); expect((await approve(returned.body.id)).status).toBe(200);
    const investmentReport = await request(app).get(`/api/finance/investments/${investmentId}`).set(headers('ADMIN')).expect(200); expect(investmentReport.body.outstanding).toBe('150.00'); expect(investmentReport.body.profit).toBe('10.00');
    expect(await investmentSummary()).toEqual({ invested: '200.00', principalReturned: '50.00', outstanding: '150.00', profit: '10.00' });
    expect(await investmentSummary(otherSocietyId)).toEqual({ invested: '0.00', principalReturned: '0.00', outstanding: '0.00', profit: '0.00' });
    await request(app).get('/api/finance/investment-summary').set(headers('MEMBER')).expect(403);
    const overReturn = await send({ type:'INVESTMENT_RETURN', investmentId, amount:'151', principalReturned:'151', profit:'0' }); expect((await approve(overReturn.body.id)).status).toBe(409);
    const expense = await send({ type: 'EXPENSE', amount: '30', category: 'Rent', payee: 'Landlord' });
    expect(await expenseSummary()).toEqual({ gross: '0.00', reversals: '0.00', net: '0.00', pending: 1 });
    expect((await approve(expense.body.id)).status).toBe(200);
    expect(await expenseSummary({ from: '2026-11-09', to: '2026-11-09' })).toEqual({ gross: '30.00', reversals: '0.00', net: '30.00', pending: 0 });
    expect(await expenseSummary({}, otherSocietyId)).toEqual({ gross: '0.00', reversals: '0.00', net: '0.00', pending: 0 });
    await request(app).get('/api/finance/expense-summary').set(headers('MEMBER')).expect(403);
    const bank = await db.ledgerAccount.findFirstOrThrow({ where: { societyId, code:'BANK-01' } });
    const beforeTransfer = await request(app).get('/api/finance/bank-summary').set(headers('ADMIN')).expect(200);
    const transfer = await send({ type: 'TRANSFER', amount: '100', destinationAccountId: bank.id }); expect((await approve(transfer.body.id)).status).toBe(200);
    const report = await request(app).get('/api/finance/bank-summary').set(headers('ADMIN')).expect(200);
    expect(report.body.expenses).toBe('30.00'); expect(report.body.items.find((r:{id:string})=>r.id===cashId).closing).toBe('680.35'); expect(report.body.items.find((r:{id:string})=>r.id===bank.id).closing).toBe('100.00');
    expect(report.body.summary).toEqual(beforeTransfer.body.summary);
    expect(report.body.summary).toMatchObject({ opening: '0.00', closing: '780.35' });
    const own = await request(app).get('/api/finance/loans/me').set(headers('MEMBER')).expect(200); expect(own.body.items.map((r:{id:string})=>r.id)).toContain(loanId);
    await request(app).get(`/api/finance/loans/me/${loanId}`).set(headers('MEMBER')).expect(200);
    await request(app).get(`/api/finance/loans/${loanId}`).set(headers('ADMIN',otherSocietyId)).expect(404);
    await request(app).get('/api/finance/investments').set(headers('MEMBER')).expect(403);
    const ownSavings = await request(app).get('/api/finance/statements/me').set(headers('MEMBER')).expect(200); expect(ownSavings.body.closingBalance).toBe('1030.35');
    const reverse = async (id:string) => { const r=await request(app).post(`/api/finance/transactions/${id}/reversal`).set(headers('ACCOUNTANT')).set('Idempotency-Key',randomUUID()).send({effectiveDate:'2026-11-09',note:'Correct business posting'}).expect(201); return approve(r.body.id); };
    const expenseReversal = await request(app).post(`/api/finance/transactions/${expense.body.id}/reversal`)
      .set(headers('ACCOUNTANT')).set('Idempotency-Key', randomUUID()).send({ effectiveDate: '2026-11-09', note: 'Correct expense posting' }).expect(201);
    expect(await expenseSummary()).toEqual({ gross: '30.00', reversals: '0.00', net: '30.00', pending: 1 });
    expect((await approve(expenseReversal.body.id)).status).toBe(200);
    expect(await expenseSummary()).toEqual({ gross: '30.00', reversals: '30.00', net: '0.00', pending: 0 });
    expect(await expenseSummary({ from: '2026-11-10' })).toEqual({ gross: '0.00', reversals: '0.00', net: '0.00', pending: 0 });
    expect((await reverse(returned.body.id)).status).toBe(200);
    const restored = await request(app).get(`/api/finance/investments/${investmentId}`).set(headers('ADMIN')).expect(200); expect(restored.body.outstanding).toBe('200.00');expect(restored.body.profit).toBe('0.00');
    expect(await investmentSummary()).toEqual({ invested: '200.00', principalReturned: '0.00', outstanding: '200.00', profit: '0.00' });
    expect((await reverse(pending.body.id)).status).toBe(409);
    const second = await send({type:'LOAN_DISBURSEMENT',memberId:secondMemberId,amount:'1',installmentCount:1,firstDueDate:'2027-01-31'}); const secondPosted=await approve(second.body.id);expect(secondPosted.status).toBe(200);
    await request(app).get(`/api/finance/loans/me/${secondPosted.body.loanId}`).set(headers('MEMBER')).expect(404);
    await request(app).post('/api/finance/transactions').set(headers('ADMIN',otherSocietyId)).set('Idempotency-Key',randomUUID()).send({type:'LOAN_REPAYMENT',loanId,amount:'1',cashAccountId:otherCashId,effectiveDate:'2026-11-09'}).expect(404);
    await request(app).post('/api/finance/transactions').set(headers('ACCOUNTANT')).set('Idempotency-Key',randomUUID()).send({type:'TRANSFER',amount:'1',cashAccountId:cashId,destinationAccountId:otherCashId,effectiveDate:'2026-11-09'}).expect(404);
    const payA=await send({type:'LOAN_REPAYMENT',loanId,amount:'60'});const payB=await send({type:'LOAN_REPAYMENT',loanId,amount:'60'});
    const payments=await Promise.all([approve(payA.body.id),approve(payB.body.id)]);expect(payments.map(r=>r.status).sort()).toEqual([200,409]);
    expect((await request(app).get(`/api/finance/loans/${loanId}`).set(headers('ADMIN')).expect(200)).body.outstanding).toBe('20.00');
    expect((await reverse(investment.body.id)).status).toBe(200);
    expect((await request(app).get(`/api/finance/investments/${investmentId}`).set(headers('ADMIN')).expect(200)).body.status).toBe('CANCELLED');
    expect(await investmentSummary()).toEqual({ invested: '0.00', principalReturned: '0.00', outstanding: '0.00', profit: '0.00' });
    const afterPeriod=await request(app).get('/api/finance/bank-summary').query({from:'2026-11-10'}).set(headers('ADMIN')).expect(200);expect(afterPeriod.body.items.every((r:{opening:string;closing:string;deposits:string;withdrawals:string})=>r.opening===r.closing&&r.deposits==='0.00'&&r.withdrawals==='0.00')).toBe(true);
    expect(afterPeriod.body.summary).toEqual({ opening: afterPeriod.body.summary.closing, incoming: '0.00', outgoing: '0.00', closing: afterPeriod.body.summary.closing });
    const beforeTransferReversal = await request(app).get('/api/finance/bank-summary').set(headers('ADMIN')).expect(200);
    expect((await reverse(transfer.body.id)).status).toBe(200);
    const afterTransferReversal = await request(app).get('/api/finance/bank-summary').set(headers('ADMIN')).expect(200);
    expect(afterTransferReversal.body.summary).toEqual(beforeTransferReversal.body.summary);
    expect(afterTransferReversal.body.items.find((row: { id: string }) => row.id === bank.id).closing).toBe('0.00');
    const accountFilter = { accountId: bank.id, from: '2026-11-09', to: '2026-11-09' };
    const bankReport = await request(app).get('/api/finance/reports/bank').set(headers('ADMIN')).query(accountFilter).expect(200);
    expect(bankReport.body.items).toMatchObject([{ id: bank.id, deposits: '100.00', withdrawals: '100.00', closing: '0.00' }]);
    const bankStatement = await request(app).get('/api/finance/reports/bank-statement').set(headers('ADMIN')).query(accountFilter).expect(200);
    expect(bankStatement.body.summary).toEqual(bankReport.body.summary);
    expect(bankStatement.body.items).toMatchObject([
      { transactionNo: transfer.body.transactionNo, incoming: '100.00', outgoing: '0.00', balance: '100.00', details: 'Main cash · CASH-01' },
      { movement: 'Reversal · Transfer', incoming: '0.00', outgoing: '100.00', balance: '0.00' },
    ]);
    const pendingReversal = await request(app).post(`/api/finance/transactions/${second.body.id}/reversal`)
      .set(headers('ACCOUNTANT')).set('Idempotency-Key', randomUUID()).send({ effectiveDate: '2026-11-09', note: 'Undo second loan' }).expect(201);
    expect(await loanSummary()).toEqual({ disbursed: '101.01', repaid: '80.01', outstanding: '21.00', pending: 4 });
    expect((await approve(pendingReversal.body.id)).status).toBe(200);
    expect((await reverse(repayment.body.id)).status).toBe(200);
    expect(await loanSummary()).toEqual({ disbursed: '100.01', repaid: '60.00', outstanding: '40.01', pending: 3 });

    const statementPath = '/api/finance/reports/member-statement';
    const memberQuery = { memberId, from: '2026-11-09', to: '2026-11-09' };
    const statement = await request(app).get(statementPath).set(headers('ACCOUNTANT')).query({ ...memberQuery, scope: 'full' }).expect(200);
    expect(statement.body.member).toEqual({ id: memberId, fullName: 'Finance Member', memberNo: `FIN-${tag}` });
    expect(statement.body.summary).toContainEqual({ label: 'Closing savings', amount: '1030.35' });
    expect(statement.body.summary).toContainEqual({ label: 'Closing loan balance', amount: '40.01' });
    const statementTransactions = statement.body.items.map((row: { transactionNo: string }) => row.transactionNo);
    expect(statementTransactions).toEqual(expect.arrayContaining([fund.body.transactionNo, disbursement.body.transactionNo, repayment.body.transactionNo]));
    expect(statementTransactions).not.toContain(second.body.transactionNo);
    const followingPeriod = await request(app).get(statementPath).set(headers('ADMIN')).query({ memberId, from: '2026-11-10' }).expect(200);
    expect(followingPeriod.body.items).toEqual([]);
    expect(followingPeriod.body.summary).toContainEqual({ label: 'Opening loan balance', amount: '40.01' });
    const secondLoans = await request(app).get('/api/finance/reports/loans').set(headers('ADMIN')).query({ memberId: secondMemberId }).expect(200);
    expect(secondLoans.body.items.map((row: { transactionNo: string }) => row.transactionNo).sort()).toEqual([pendingReversal.body.transactionNo, second.body.transactionNo].sort());

    const disbursements = await request(app).get('/api/finance/reports/loan-disbursements').set(headers('ACCOUNTANT')).query(memberQuery).expect(200);
    expect(disbursements.body.items).toMatchObject([{ transactionNo: disbursement.body.transactionNo, movement: 'Loan disbursement', amount: '100.01' }]);
    expect(disbursements.body.summary).toContainEqual({ label: 'Net disbursed', amount: '100.01' });
    const cancelledDisbursement = await request(app).get('/api/finance/reports/loan-disbursements').set(headers('ADMIN')).query({ memberId: secondMemberId }).expect(200);
    expect(cancelledDisbursement.body.summary).toContainEqual({ label: 'Net disbursed', amount: '0.00' });
    expect(cancelledDisbursement.body.items).toContainEqual(expect.objectContaining({ movement: 'Reversal · Loan disbursement', amount: '-1.00' }));
    const repayments = await request(app).get('/api/finance/reports/loan-repayments').set(headers('ADMIN')).query({ ...memberQuery, scope: 'full' }).expect(200);
    expect(repayments.body.items.map((row: { amount: string }) => row.amount).sort()).toEqual(['-20.01', '20.01', '60.00']);
    expect(repayments.body.summary).toEqual([
      { label: 'Gross repaid', amount: '80.01' }, { label: 'Repayment reversals', amount: '20.01' }, { label: 'Net repaid', amount: '60.00' },
    ]);
    const combined = await request(app).get('/api/finance/reports/loans').set(headers('ADMIN')).query(memberQuery).expect(200);
    expect(combined.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ transactionNo: disbursement.body.transactionNo, disbursed: '100.01', repaid: '0.00' }),
      expect.objectContaining({ transactionNo: repayment.body.transactionNo, disbursed: '0.00', repaid: '20.01' }),
      expect.objectContaining({ movement: 'Reversal · Loan repayment', disbursed: '0.00', repaid: '-20.01' }),
    ]));
    expect(combined.body.summary).toContainEqual({ label: 'Closing receivables', amount: '40.01' });
    await request(app).get('/api/finance/reports/loan-repayments').set(headers('ADMIN', otherSocietyId)).query(memberQuery).expect(404);
    await request(app).get('/api/finance/reports/loan-disbursements').set(headers('MEMBER')).query(memberQuery).expect(403);

    await request(app).get(statementPath).set(headers('ADMIN')).expect(422);
    await request(app).get(statementPath).set(headers('ADMIN', otherSocietyId)).query(memberQuery).expect(404);
    await request(app).get(statementPath).set(headers('MEMBER')).query({ ...memberQuery, scope: 'full' }).expect(403);
    const search = { search: `FIN-${tag}` };
    const members = await request(app).get('/api/finance/report-members').set(headers('ACCOUNTANT')).query(search).expect(200);
    expect(members.body.items).toEqual([statement.body.member]);
    const otherMembers = await request(app).get('/api/finance/report-members').set(headers('ADMIN', otherSocietyId)).query(search).expect(200);
    expect(otherMembers.body.items).toEqual([]);
  });
  it('reports other income and investment profit by date, including approved reversals', async () => {
    const totals = async (from = '2026-11-10', to?: string) =>
      (await request(app).get('/api/finance/income-summary').set(headers('ADMIN')).query({ from, ...(to ? { to } : {}) }).expect(200)).body;
    const send = (data: Record<string, unknown>) =>
      request(app).post('/api/finance/transactions').set(headers('ACCOUNTANT')).set('Idempotency-Key', randomUUID())
        .send({ effectiveDate: '2026-11-10', cashAccountId: cashId, ...data }).expect(201);
    const funds = await send({ type: 'DEPOSIT', amount: '100', memberId });
    expect((await approve(funds.body.id)).status).toBe(200);
    const openingSavings = await balance();
    const other = await send({ type: 'OTHER_INCOME', amount: '50.75', note: 'November shop rent' });
    expect(other.body.member).toBeNull();
    expect(other.body.note).toBe('November shop rent');
    expect(await totals()).toEqual({ otherIncome: '0.00', investmentProfit: '0.00', total: '0.00' });
    const posted = await approve(other.body.id);
    expect(posted.status).toBe(200);
    expect(posted.body.entries).toMatchObject([
      { account: { code: 'CASH-01' }, debit: '50.75', credit: '0' },
      { account: { name: 'Other income' }, debit: '0', credit: '50.75' },
    ]);
    const purchase = await send({ type: 'INVESTMENT_PURCHASE', amount: '40', title: 'Term deposit', counterparty: 'Test bank' });
    const approvedPurchase = await approve(purchase.body.id);
    expect(approvedPurchase.status).toBe(200);
    const investmentId = approvedPurchase.body.investmentId;
    const principalOnly = await send({ type: 'INVESTMENT_RETURN', investmentId, amount: '3', principalReturned: '3', profit: '0.0' });
    expect((await approve(principalOnly.body.id)).status).toBe(200);
    const combinedReturn = await send({ type: 'INVESTMENT_RETURN', investmentId, amount: '22.25', principalReturned: '20', profit: '2.25' });
    expect((await approve(combinedReturn.body.id)).status).toBe(200);
    expect(await totals()).toEqual({ otherIncome: '50.75', investmentProfit: '2.25', total: '53.00' });

    const reversal = await request(app).post(`/api/finance/transactions/${other.body.id}/reversal`)
      .set(headers('ACCOUNTANT')).set('Idempotency-Key', randomUUID())
      .send({ effectiveDate: '2026-11-11', note: 'Duplicate rent receipt' }).expect(201);
    expect((await approve(reversal.body.id)).status).toBe(200);
    expect(await totals('2026-11-10', '2026-11-10')).toEqual({ otherIncome: '50.75', investmentProfit: '2.25', total: '53.00' });
    expect(await totals('2026-11-11')).toEqual({ otherIncome: '-50.75', investmentProfit: '0.00', total: '-50.75' });
    expect(await totals()).toEqual({ otherIncome: '0.00', investmentProfit: '2.25', total: '2.25' });

    const incomeReport = '/api/finance/reports/income';
    const full = await request(app).get(incomeReport).set(headers('ADMIN')).query({ from: '2026-11-10', scope: 'full' }).expect(200);
    expect(full.body.summary).toContainEqual({ label: 'Total income', amount: '2.25' });
    expect(full.body.items.map((row: { amount: string }) => row.amount).sort()).toEqual(['-50.75', '2.25', '50.75']);
    const filtered = await request(app).get(incomeReport).set(headers('ADMIN')).query({ from: '2026-11-11', to: '2026-11-11' }).expect(200);
    expect(filtered.body.items).toMatchObject([{ date: '2026-11-11', amount: '-50.75' }]);
    expect((await request(app).get(incomeReport).set(headers('ADMIN', otherSocietyId)).expect(200)).body.items).toEqual([]);
    await request(app).get(incomeReport).set(headers('MEMBER')).query({ scope: 'full' }).expect(403);

    const history = await request(app).get('/api/finance/transactions').set(headers('ADMIN')).query({ scope: 'income', from: '2026-11-10' }).expect(200);
    expect(history.body.total).toBe(3);
    expect(history.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: other.body.id, note: 'November shop rent' }),
      expect.objectContaining({ id: combinedReturn.body.id, investment: { title: 'Term deposit' }, details: expect.objectContaining({ profit: '2.25' }) }),
      expect.objectContaining({ id: reversal.body.id, reversalOf: expect.objectContaining({ id: other.body.id }) }),
    ]));
    expect(await balance()).toBe(openingSavings);
    const otherTenant = await request(app).get('/api/finance/income-summary').set(headers('ADMIN', otherSocietyId)).expect(200);
    expect(otherTenant.body.total).toBe('0.00');
    await request(app).get('/api/finance/income-summary').set(headers('MEMBER')).expect(403);
  });

  it('closes membership after posted settlement and prevents new activity on the closed account', async () => {
    const admin = headers('SOCIETY_ADMIN');
    const profile = {
      fullName: 'Settling Member', phone: '01700000000', address: 'Dhaka', joinedAt: '2026-01-01',
      nominees: [{ fullName: 'Test Nominee', relationship: 'Sibling', phone: '01800000000', address: 'Dhaka', sharePercent: '100' }],
    };
    await request(app).post('/api/members').set(admin).send({ ...profile, status: 'CLOSED' }).expect(422);
    const created = await request(app).post('/api/members').set(admin).send(profile).expect(201);
    const path = `/api/members/${created.body.id}`;
    const close = () => request(app).put(path).set(admin).send({ ...profile, status: 'CLOSED', version: created.body.version });
    const cash = await request(app).post('/api/finance/accounts').set(admin).send({ code: 'SETTLEMENT-CASH', name: 'Settlement cash', kind: 'CASH' }).expect(201);
    const send = (data: Record<string, unknown>) => request(app).post('/api/finance/transactions')
      .set(headers('ACCOUNTANT')).set('Idempotency-Key', randomUUID())
      .send({ cashAccountId: cash.body.id, effectiveDate: '2026-11-09', ...data });
    const deposit = () => send({ type: 'DEPOSIT', memberId: created.body.id, amount: '100' });

    const pending = await deposit().expect(201);
    expect((await close().expect(409)).body.error.message).toContain('pending member transactions');
    expect((await approve(pending.body.id)).status).toBe(200);
    expect((await close().expect(409)).body.error.message).toContain('savings balance (100.00 BDT)');
    await request(app).delete(path).set(admin).send({ version: created.body.version }).expect(409);

    const loan = await send({ type: 'LOAN_DISBURSEMENT', memberId: created.body.id, amount: '40', installmentCount: 1, firstDueDate: '2026-11-09' }).expect(201);
    const postedLoan = await approve(loan.body.id);
    expect(postedLoan.status).toBe(200);
    const loanId = postedLoan.body.loanId;
    const post = async (data: Record<string, unknown>) => {
      const pending = await send(data).expect(201);
      const posted = await approve(pending.body.id);
      expect(posted.status).toBe(200);
      return posted.body.id as string;
    };
    await post({ type: 'LOAN_REPAYMENT', loanId, amount: '39.99' });
    await post({ type: 'WITHDRAWAL', memberId: created.body.id, amount: '99.99' });
    const blocked = await close().expect(409);
    expect(blocked.body.error.message).toContain('loan balance (0.01 BDT)');
    expect(blocked.body.error.message).toContain('savings balance (0.01 BDT)');

    const finalRepayment = await post({ type: 'LOAN_REPAYMENT', loanId, amount: '0.01' });
    await post({ type: 'WITHDRAWAL', memberId: created.body.id, amount: '0.01' });
    const closed = await close().expect(200);
    expect(closed.body.status).toBe('CLOSED');
    await request(app).put(path).set(admin).send({ ...profile, status: 'ACTIVE', version: closed.body.version }).expect(409);
    await request(app).post(`${path}/login`).set(admin).send({ email: `${tag}-closed@finance.test`, password }).expect(409);
    await deposit().expect(404);
    await send({ type: 'LOAN_REPAYMENT', loanId, amount: '1' }).expect(409);
    await request(app).post(`/api/finance/transactions/${finalRepayment}/reversal`).set(headers('ACCOUNTANT'))
      .set('Idempotency-Key', randomUUID()).send({ effectiveDate: '2026-11-09', note: 'Reopen loan balance' }).expect(409);
    const statement = await request(app).get(`/api/finance/statements/${created.body.id}`).set(admin).expect(200);
    expect(statement.body.closingBalance).toBe('0.00');
    expect(statement.body.total).toBe(3);
    expect(await db.auditLog.count({ where: { societyId, entityId: created.body.id, action: 'MEMBER_CLOSED' } })).toBe(1);
  });

  it('settles savings and individual loans and reconciles the detailed statement after closing', async () => {
    const admin = headers('SOCIETY_ADMIN');
    const accountant = headers('ACCOUNTANT');
    const member = await db.member.create({ data: {
      societyId, memberNo: `SETTLE-${tag}`, fullName: 'Final Settlement Member', phone: '01700000000',
      address: 'Dhaka', joinedAt: new Date('2026-01-01'),
    } });
    const account = await request(app).post('/api/finance/accounts').set(admin)
      .send({ code: 'FINAL-SETTLEMENT', name: 'Final settlement cash', kind: 'CASH' }).expect(201);
    const path = `/api/members/${member.id}/settlement`;
    const fields = { cashAccountId: account.body.id, effectiveDate: '2026-11-09' };
    const paymentDate = '2026-11-10';
    const overview = () => request(app).get(path).set(accountant).expect(200);
    const statement = () => request(app).get(`${path}/statement`).set(accountant);
    const start = () => request(app).post(path).set(admin);
    const close = () => request(app).post(`${path}/close`).set(admin);
    const submitMember = (data: Record<string, unknown>) => request(app).post('/api/finance/transactions')
      .set(accountant).set('Idempotency-Key', randomUUID()).send({ ...fields, ...data });
    const pay = (loanId: string | null, amount: string, key = randomUUID()) => request(app).post(`${path}/payments`)
      .set(accountant).set('Idempotency-Key', key).send({ ...fields, effectiveDate: paymentDate, loanId, amount, reference: 'Settlement receipt' });
    const post = async (data: Record<string, unknown>) => {
      const pending = await submitMember(data).expect(201);
      const response = await approve(pending.body.id);
      expect(response.status).toBe(200);
      return response.body;
    };

    const deposit = await submitMember({ type: 'DEPOSIT', memberId: member.id, amount: '200.00' }).expect(201);
    await start().expect(409);
    expect((await statement().expect(200)).body.items).toEqual([]);
    expect((await approve(deposit.body.id)).status).toBe(200);
    const loanInput = { type: 'LOAN_DISBURSEMENT', memberId: member.id, installmentCount: 3, firstDueDate: fields.effectiveDate };
    const firstLoan = await post({ ...loanInput, amount: '60.00' });
    const secondLoan = await post({ ...loanInput, amount: '25.00' });
    await post({ type: 'LOAN_REPAYMENT', loanId: firstLoan.loanId, amount: '10.00' });

    await request(app).get(path).set(headers('ADMIN', otherSocietyId)).expect(404);
    await request(app).post(path).set(accountant).expect(403);
    const started = await start().expect(200);
    expect(started.body.status).toBe('OPEN');
    expect(started.body.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ loanId: null, due: '200.00', paid: '0.00' }),
      expect.objectContaining({ loanId: firstLoan.loanId, due: '50.00', paid: '0.00' }),
      expect.objectContaining({ loanId: secondLoan.loanId, due: '25.00', paid: '0.00' }),
    ]));
    await submitMember({ type: 'LOAN_REPAYMENT', loanId: firstLoan.loanId, amount: '1.00' }).expect(409);
    await close().expect(409);

    const key = randomUUID();
    const competing = await Promise.all([pay(firstLoan.loanId, '30', key), pay(firstLoan.loanId, '30', key)]);
    expect(competing.map(response => response.status)).toEqual([201, 201]);
    expect(competing[0]!.body.id).toBe(competing[1]!.body.id);
    await pay(firstLoan.loanId, '20.01').expect(409);
    expect((await overview()).body.lines).toContainEqual(expect.objectContaining({
      loanId: firstLoan.loanId, paid: '0.00', pending: '30.00', available: '20.00',
    }));
    const partialPayment = competing[0]!.body;
    expect((await approve(partialPayment.id)).status).toBe(200);
    const correction = await request(app).post(`/api/finance/transactions/${partialPayment.id}/reversal`)
      .set(accountant).set('Idempotency-Key', randomUUID())
      .send({ effectiveDate: paymentDate, note: 'Correct settlement receipt' }).expect(201);
    expect((await approve(correction.body.id)).status).toBe(200);
    expect((await overview()).body.lines).toContainEqual(expect.objectContaining({
      loanId: firstLoan.loanId, paid: '0.00', remaining: '50.00',
    }));

    await db.member.update({ where: { id: member.id }, data: { status: 'INACTIVE' } });
    const repayment1 = await pay(firstLoan.loanId, '50').expect(201);
    const repayment2 = await pay(secondLoan.loanId, '25').expect(201);
    const refund = await pay(null, '200').expect(201);
    expect((await approve(refund.body.id)).status).toBe(409);
    for (const item of [repayment1, repayment2, refund]) expect((await approve(item.body.id)).status).toBe(200);

    const closed = await close().expect(200);
    expect(closed.body).toMatchObject({ status: 'CLOSED', pendingTransactions: 0 });
    expect(closed.body.closedAt).toEqual(expect.any(String));
    expect(closed.body.lines.map((line: { remaining: string }) => line.remaining)).toEqual(['0.00', '0.00', '0.00']);
    expect(closed.body.payments).toHaveLength(5);
    expect(closed.body.payments).toContainEqual(expect.objectContaining({ amount: '200.00', type: 'WITHDRAWAL', status: 'POSTED' }));
    expect((await close().expect(200)).body.closedAt).toBe(closed.body.closedAt);
    await request(app).post(`${path}/cancel`).set(admin).send({ settlementId: closed.body.id }).expect(409);
    await pay(null, '1').expect(404);
    expect(await db.auditLog.count({ where: { societyId, entityId: member.id, action: 'MEMBER_SETTLEMENT_COMPLETED' } })).toBe(1);

    await request(app).get(`${path}/statement`).set(headers('ADMIN', otherSocietyId)).expect(404);
    await request(app).get(`${path}/statement`).set(headers('MEMBER')).expect(403);
    await statement().query({ from: paymentDate, to: fields.effectiveDate }).expect(422);
    const full = (await statement().expect(200)).body;
    expect(full.total).toBe(9);
    expect(full.items).toContainEqual(expect.objectContaining({
      id: deposit.body.id, paidByMember: '200.00', paidBySociety: '0.00', savingsAfter: '200.00', loanAfter: '0.00', settlement: false,
    }));
    expect(full.items).toContainEqual(expect.objectContaining({
      id: refund.body.id, paidByMember: '0.00', paidBySociety: '200.00', savingsAfter: '0.00', loanAfter: '0.00', settlement: true,
    }));
    const untilPayments = (await statement().query({ to: fields.effectiveDate }).expect(200)).body;
    expect(untilPayments).toMatchObject({ total: 4, savings: { closing: '200.00' }, loans: { closing: '75.00' } });
    const dateFilter = { from: paymentDate, to: paymentDate };
    const period = (await statement().query(dateFilter).expect(200)).body;
    expect(period.savings).toEqual({ opening: '200.00', deposits: '0.00', withdrawals: '200.00', closing: '0.00' });
    expect(period.loans).toEqual({ opening: '75.00', disbursed: '30.00', repaid: '105.00', closing: '0.00' });
    expect(period.items).toContainEqual(expect.objectContaining({
      id: correction.body.id, paidBySociety: '30.00', loanAfter: '75.00', loanNumber: firstLoan.transactionNo,
      reversalOf: { transactionNo: partialPayment.transactionNo, type: 'LOAN_REPAYMENT' },
    }));
    const secondPage = (await statement().query({ ...dateFilter, pageSize: 2, page: 2 }).expect(200)).body;
    expect(secondPage.items).toEqual(period.items.slice(2, 4));
    const olderPage = (await statement().query({ pageSize: 3, page: 3 }).expect(200)).body;
    expect(olderPage.items).toEqual(full.items.slice(6));
  });

  it('cancels a settlement, releases regular transactions and preserves posted payments', async () => {
    const admin = headers('SOCIETY_ADMIN');
    const accountant = headers('ACCOUNTANT');
    const member = await db.member.create({ data: {
      societyId, memberNo: `CANCEL-${tag}`, fullName: 'Settlement Cancellation Member', phone: '01700000000',
      address: 'Dhaka', joinedAt: new Date('2026-01-01'),
    } });
    const account = await request(app).post('/api/finance/accounts').set(admin)
      .send({ code: 'CANCEL-SETTLEMENT', name: 'Settlement cancellation cash', kind: 'CASH' }).expect(201);
    const path = `/api/members/${member.id}/settlement`;
    const fields = { cashAccountId: account.body.id, effectiveDate: '2026-11-09' };
    const deposit = (amount: string) => request(app).post('/api/finance/transactions').set(accountant)
      .set('Idempotency-Key', randomUUID()).send({ ...fields, type: 'DEPOSIT', memberId: member.id, amount });
    const pay = (settlementId: string, amount: string) => request(app).post(`${path}/payments`).set(accountant)
      .set('Idempotency-Key', randomUUID()).send({ ...fields, settlementId, amount });
    const cancel = (settlementId: string) => request(app).post(`${path}/cancel`).set(admin).send({ settlementId });
    const start = () => request(app).post(path).set(admin).expect(200);

    const opening = await deposit('200').expect(201);
    expect((await approve(opening.body.id)).status).toBe(200);
    const first = (await start()).body;
    await deposit('1').expect(409);
    const posted = await pay(first.id, '10').expect(201);
    expect((await approve(posted.body.id)).status).toBe(200);
    const pending = await pay(first.id, '20').expect(201);
    await request(app).post(`${path}/cancel`).set(accountant).send({ settlementId: first.id }).expect(403);
    await request(app).post(`${path}/cancel`).set(headers('SUPER_ADMIN', otherSocietyId)).send({ settlementId: first.id }).expect(404);
    const cancelled = (await cancel(first.id).expect(200)).body;
    expect(cancelled).toMatchObject({ id: null, status: 'NOT_STARTED', pendingTransactions: 0, lines: [{ due: '190.00' }] });
    expect((await approve(pending.body.id)).status).toBe(409);
    expect(await db.financialTransaction.findUniqueOrThrow({ where: { id: pending.body.id } })).toMatchObject({ status: 'CANCELLED', settlementId: first.id });
    expect(await db.financialTransaction.findUniqueOrThrow({ where: { id: posted.body.id } })).toMatchObject({ status: 'POSTED', settlementId: first.id });
    expect(await db.member.findUniqueOrThrow({ where: { id: member.id } })).toMatchObject({ status: 'ACTIVE' });

    const newDeposit = await deposit('5').expect(201);
    expect((await approve(newDeposit.body.id)).status).toBe(200);
    const second = (await start()).body;
    expect(second).toMatchObject({ status: 'OPEN', lines: [{ due: '195.00' }] });
    expect(second.id).not.toBe(first.id);
    expect((await cancel(first.id).expect(200)).body.id).toBe(second.id);
    await pay(first.id, '5').expect(409);
    await request(app).post(`${path}/close`).set(admin).send({ settlementId: first.id }).expect(409);
    const reversePosted = () => request(app).post(`/api/finance/transactions/${posted.body.id}/reversal`).set(accountant)
      .set('Idempotency-Key', randomUUID()).send({ effectiveDate: fields.effectiveDate, note: 'Correct paid refund' });
    await reversePosted().expect(409);
    await cancel(second.id).expect(200);
    await reversePosted().expect(201);
    const records = await db.memberSettlement.findMany({ where: { societyId, memberId: member.id } });
    expect(records).toHaveLength(2);
    expect(records.every(record => record.cancelledAt && record.isCurrent === null)).toBe(true);
    expect(await db.auditLog.count({ where: { societyId, entityId: member.id, action: 'MEMBER_SETTLEMENT_CANCELLED' } })).toBe(2);
  });

  it('limits rejected transaction deletion to admins and retains the complete audit history', async () => {
    const actor = headers('SOCIETY_ADMIN');
    const before = await balance();
    const body = input('DEPOSIT', '11.25');
    const key = randomUUID();
    const submitted = await submit(body, key);
    expect(submitted.status).toBe(201);
    const pending = submitted.body;
    const path = `/api/finance/transactions/${pending.id}`;
    await request(app).delete(path).set(actor).expect(409);
    await request(app).post(`${path}/decision`).set(headers('APPROVER')).send({ decision: 'REJECT', comment: 'Incorrect payment reference' }).expect(200);
    for (const role of ['ACCOUNTANT', 'APPROVER', 'MEMBER']) await request(app).delete(path).set(headers(role)).expect(403);
    await request(app).delete(path).set(headers('ADMIN', otherSocietyId)).expect(404);
    await Promise.all([request(app).delete(path).set(actor).expect(204), request(app).delete(path).set(actor).expect(204)]);
    await request(app).get(path).set(actor).expect(404);
    expect((await submit(body, key)).status).toBe(409);
    const rejected = await request(app).get('/api/finance/transactions').set(actor).query({ status: 'REJECTED', pageSize: 100 }).expect(200);
    expect(rejected.body.items.map((row: { id: string }) => row.id)).not.toContain(pending.id);
    expect(await db.approvalDecision.count({ where: { societyId, transactionId: pending.id } })).toBe(1);
    expect(await balance()).toBe(before);
    await request(app).delete(`/api/finance/transactions/${depositId}`).set(actor).expect(409);

    const log = (params: Record<string, string | number> = {}, scope = actor) => request(app).get('/api/finance/transaction-log')
      .set(scope).query({ transactionNo: pending.transactionNo, ...params });
    const first = await log({ limit: 1 }).expect(200);
    expect(first.body.items).toMatchObject([{ action: 'FINANCE_DELETED', actor: { id: userIds.SOCIETY_ADMIN }, transaction: { transactionNo: pending.transactionNo, amount: '11.25', deletedAt: expect.any(String) } }]);
    const rest = await log({ after: first.body.nextCursor }).expect(200);
    expect(rest.body.items).toMatchObject([{ action: 'FINANCE_REJECTED', changes: { comment: 'Incorrect payment reference' } }, { action: 'FINANCE_REQUESTED' }]);
    expect(rest.body.nextCursor).toBeNull();
    expect((await log({ action: 'FINANCE_DELETED' }).expect(200)).body.items).toHaveLength(1);
    expect((await log({}, headers('ADMIN', otherSocietyId)).expect(200)).body.items).toEqual([]);
    await request(app).get('/api/finance/transaction-log').set(headers('ADMIN', otherSocietyId)).query({ after: first.body.nextCursor }).expect(422);
    await log({}, headers('MEMBER')).expect(403);

    for (const role of ['ADMIN', 'SUPER_ADMIN']) {
      const row = await submit(body);
      expect(row.status).toBe(201);
      const url = `/api/finance/transactions/${row.body.id}`;
      await request(app).post(`${url}/decision`).set(headers('APPROVER')).send({ decision: 'REJECT', comment: 'Duplicate request' }).expect(200);
      await request(app).delete(url).set(headers(role)).expect(204);
    }
  });

  it('shows member and staff actions with the recorded role and enforces activity visibility', async () => {
    const member = headers('MEMBER');
    const approver = headers('APPROVER');
    const admin = headers('SOCIETY_ADMIN');
    await request(app).get('/api/members/me').set(member).expect(200);
    await request(app).get('/api/finance/statements/me').set(member).expect(200);
    await request(app).post('/api/auth/select-society').set(admin).expect(200);

    const personal = await request(app).get('/api/activity/me').set(member).expect(200);
    expect(personal.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'AUTH_LOGIN', actorRole: 'MEMBER' }),
      expect.objectContaining({ action: 'MEMBER_PROFILE_VIEWED', actorRole: 'MEMBER', entityId: memberId }),
      expect.objectContaining({ action: 'FINANCE_STATEMENT_VIEWED', actorRole: 'MEMBER' }),
    ]));
    expect(personal.body.items.every((item: { actor: { id: string } }) => item.actor.id === userIds.MEMBER)).toBe(true);
    expect(personal.body.items[0]).not.toHaveProperty('changes');
    await request(app).get('/api/activity').set(member).expect(403);
    await request(app).get('/api/activity').set(approver).expect(403);
    await request(app).get('/api/activity/platform').set(admin).expect(403);

    const decisions = await request(app).get('/api/activity').set(admin)
      .query({ actorRole: 'APPROVER', action: 'FINANCE_APPROVED', limit: 1 }).expect(200);
    expect(decisions.body.items).toMatchObject([{ action: 'FINANCE_APPROVED', actorRole: 'APPROVER', actor: { id: userIds.APPROVER }, targetLabel: expect.stringMatching(/^TX-/) }]);
    const older = await request(app).get('/api/activity').set(admin)
      .query({ actorRole: 'APPROVER', action: 'FINANCE_APPROVED', after: decisions.body.nextCursor }).expect(200);
    expect(older.body.items.map((item: { id: string }) => item.id)).not.toContain(decisions.body.items[0].id);
    await request(app).get('/api/activity/me').set(member).query({ after: decisions.body.nextCursor }).expect(422);
    const other = await request(app).get('/api/activity').set(headers('ADMIN', otherSocietyId)).query({ action: 'MEMBER_PROFILE_VIEWED' }).expect(200);
    expect(other.body.items).toEqual([]);

    const session = await request(app).post('/api/auth/login').set('Origin', origin)
      .send({ email: `${tag}-member@finance.test`, password }).expect(200);
    const cookie = (session.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    await request(app).post('/api/auth/logout').set('Origin', origin).set('Cookie', cookie).expect(204);
    const platform = await request(app).get('/api/activity/platform').set(headers('SUPER_ADMIN')).query({ action: 'AUTH_LOGOUT' }).expect(200);
    expect(platform.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'AUTH_LOGOUT', actorRole: 'MEMBER', actor: { id: userIds.MEMBER, name: 'Finance MEMBER' }, society: expect.objectContaining({ id: societyId }) }),
    ]));
  });
  it('carries bank running balances across pages and scopes the full statement to its account', async () => {
    const account = await request(app).post('/api/finance/accounts').set(headers('ADMIN'))
      .send({ code: 'BANK-STATEMENT', kind: 'BANK', name: 'Statement account', bankName: 'Local Bank', accountNumberLast4: '6789' }).expect(201);
    const accountId = account.body.id;
    const postIncome = async (effectiveDate: string, amount: string) => {
      const posted = await request(app).post('/api/finance/transactions').set(headers('ACCOUNTANT')).set('Idempotency-Key', randomUUID())
        .send({ type: 'OTHER_INCOME', cashAccountId: accountId, effectiveDate, amount }).expect(201);
      expect((await approve(posted.body.id)).status).toBe(200);
    };
    await postIncome('2026-11-09', '10.00');
    for (let i = 0; i < 26; i++) await postIncome('2026-11-10', '1.25');

    const path = '/api/finance/reports/bank-statement';
    const query = { accountId, from: '2026-11-10', to: '2026-11-10' };
    const preview = await request(app).get(path).set(headers('ADMIN')).query({ ...query, page: 2 }).expect(200);
    const full = await request(app).get(path).set(headers('ADMIN')).query({ ...query, scope: 'full' }).expect(200);
    expect(preview.body).toMatchObject({ account: { id: accountId, accountNumberLast4: '6789' }, total: 26, page: 2, pages: 2 });
    expect(preview.body.items).toEqual(full.body.items.slice(25));
    expect(full.body.items).toHaveLength(26);
    expect(full.body.items[0]).toMatchObject({ incoming: '1.25', balance: '11.25' });
    expect(full.body.items[25]).toMatchObject({ incoming: '1.25', balance: '42.50' });
    expect(full.body.summary).toContainEqual({ label: 'Opening balance', amount: '10.00' });
    expect(full.body.summary).toContainEqual({ label: 'Closing balance', amount: '42.50' });

    const accounts = await request(app).get('/api/finance/report-accounts').set(headers('ACCOUNTANT')).expect(200);
    expect(accounts.body.items).toContainEqual(full.body.account);
    expect(accounts.body.items.every((item: { kind: string }) => ['CASH', 'BANK'].includes(item.kind))).toBe(true);
    await request(app).get(path).set(headers('ADMIN')).expect(422);
    await request(app).get(path).set(headers('ADMIN', otherSocietyId)).query(query).expect(404);
    await request(app).get(path).set(headers('MEMBER')).query({ ...query, scope: 'full' }).expect(403);
  });

  it('manages non-member borrowers and non-member loans without membership, deposits, or user accounts', async () => {
    const memberCountBefore = await db.member.count({ where: { societyId } });
    const userCountBefore = await db.user.count();

    await request(app).get('/api/finance/borrowers').set(headers('MEMBER')).expect(403);
    const created = await request(app).post('/api/finance/borrowers').set(headers('ACCOUNTANT')).send({
      fullName: 'External Rahim',
      phone: '01711223344',
      identityNumber: '1990123456789',
      address: 'Mirpur, Dhaka',
      guarantorName: 'Karim Bhai',
      guarantorPhone: '01811223344',
      note: 'Neighbor business loan',
    }).expect(201);
    const borrowerId = created.body.id as string;
    expect(created.body.borrowerNo).toBe('NML-0001');
    expect(await db.member.count({ where: { societyId } })).toBe(memberCountBefore);
    expect(await db.user.count()).toBe(userCountBefore);

    // Non-members cannot deposit or withdraw, and loan disbursement cannot have both memberId and borrowerId
    await request(app).post('/api/finance/transactions').set(headers('ACCOUNTANT')).set('Idempotency-Key', randomUUID())
      .send({ type: 'DEPOSIT', borrowerId, cashAccountId: cashId, amount: '50', effectiveDate: '2026-11-10' }).expect(422);
    await request(app).post('/api/finance/transactions').set(headers('ACCOUNTANT')).set('Idempotency-Key', randomUUID())
      .send({ type: 'LOAN_DISBURSEMENT', memberId, borrowerId, cashAccountId: cashId, amount: '100', effectiveDate: '2026-11-10', installmentCount: 2, firstDueDate: '2026-12-10' }).expect(422);

    // Disburse non-member loan
    const disburseReq = await request(app).post('/api/finance/transactions').set(headers('ACCOUNTANT')).set('Idempotency-Key', randomUUID())
      .send({ type: 'LOAN_DISBURSEMENT', borrowerId, cashAccountId: cashId, amount: '150.00', effectiveDate: '2026-11-10', installmentCount: 3, firstDueDate: '2026-12-10', reference: 'NM-LOAN-1', note: 'Non-member loan' }).expect(201);
    expect(disburseReq.body.member).toBeNull();
    expect(disburseReq.body.borrower).toMatchObject({ id: borrowerId, fullName: 'External Rahim', borrowerNo: 'NML-0001' });
    const postedDisburse = await approve(disburseReq.body.id);
    expect(postedDisburse.status).toBe(200);
    const nonMemberLoanId = postedDisburse.body.loanId as string;

    // Filter loans by borrowerType
    const nonMemberLoans = await request(app).get('/api/finance/loans').set(headers('ADMIN')).query({ borrowerType: 'NON_MEMBER' }).expect(200);
    expect(nonMemberLoans.body.items).toHaveLength(1);
    expect(nonMemberLoans.body.items[0]).toMatchObject({ id: nonMemberLoanId, principal: '150.00', outstanding: '150.00', member: null, borrower: expect.objectContaining({ id: borrowerId, fullName: 'External Rahim' }) });
    const memberLoans = await request(app).get('/api/finance/loans').set(headers('ADMIN')).query({ borrowerType: 'MEMBER' }).expect(200);
    expect(memberLoans.body.items.every((row: { member: unknown }) => row.member !== null)).toBe(true);

    // Member cannot see non-member loan
    await request(app).get(`/api/finance/loans/me/${nonMemberLoanId}`).set(headers('MEMBER')).expect(404);
    const ownLoans = await request(app).get('/api/finance/loans/me').set(headers('MEMBER')).expect(200);
    expect(ownLoans.body.items.map((row: { id: string }) => row.id)).not.toContain(nonMemberLoanId);

    // Repay non-member loan
    const repay1 = await request(app).post('/api/finance/transactions').set(headers('ACCOUNTANT')).set('Idempotency-Key', randomUUID())
      .send({ type: 'LOAN_REPAYMENT', loanId: nonMemberLoanId, cashAccountId: cashId, amount: '50.00', effectiveDate: '2026-11-10', note: 'First installment' }).expect(201);
    expect(repay1.body.borrower?.id).toBe(borrowerId);
    expect((await approve(repay1.body.id)).status).toBe(200);

    const detail = await request(app).get(`/api/finance/borrowers/${borrowerId}`).set(headers('ADMIN')).expect(200);
    expect(detail.body).toMatchObject({ fullName: 'External Rahim', disbursed: '150.00', repaid: '50.00', outstanding: '100.00', loanCount: 1 });
    expect(detail.body.transactions).toHaveLength(2);

    // Settle remaining balance
    const repay2 = await request(app).post('/api/finance/transactions').set(headers('ACCOUNTANT')).set('Idempotency-Key', randomUUID())
      .send({ type: 'LOAN_REPAYMENT', loanId: nonMemberLoanId, cashAccountId: cashId, amount: '100.00', effectiveDate: '2026-11-10', note: 'Final payment' }).expect(201);
    expect((await approve(repay2.body.id)).status).toBe(200);
    const settledLoan = await request(app).get(`/api/finance/loans/${nonMemberLoanId}`).set(headers('ADMIN')).expect(200);
    expect(settledLoan.body).toMatchObject({ outstanding: '0.00', status: 'SETTLED' });

    // Society isolation
    await request(app).get(`/api/finance/borrowers/${borrowerId}`).set(headers('ADMIN', otherSocietyId)).expect(404);
    const updated = await request(app).patch(`/api/finance/borrowers/${borrowerId}`).set(headers('ACCOUNTANT')).send({ phone: '01799887766' }).expect(200);
    expect(updated.body.phone).toBe('01799887766');
  });

  it('serves member-scoped loan summary and own transaction reports without exposing other records', async () => {
    const loanSummary = await request(app).get('/api/finance/loan-summary/me').set(headers('MEMBER')).expect(200);
    expect(loanSummary.body).toMatchObject({
      disbursed: expect.stringMatching(/^\d+\.\d{2}$/),
      repaid: expect.stringMatching(/^\d+\.\d{2}$/),
      outstanding: expect.stringMatching(/^\d+\.\d{2}$/),
      totalLoans: expect.any(Number),
      activeLoans: expect.any(Number),
      settledLoans: expect.any(Number),
    });

    for (const kind of ['member-statement', 'savings', 'loans', 'loan-disbursements', 'loan-repayments'] as const) {
      const res = await request(app)
        .get(`/api/finance/reports/me/${kind}`)
        .set(headers('MEMBER'))
        .query({ scope: 'full', memberId: 'other-member-id' })
        .expect(200);
      expect(res.body.member?.id).toBe(memberId);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(Array.isArray(res.body.summary)).toBe(true);
    }

    await request(app).get('/api/finance/reports/me/expenses').set(headers('MEMBER')).expect(422);
    await request(app).get('/api/finance/reports/me/bank').set(headers('MEMBER')).expect(422);
    await request(app).get('/api/finance/reports/member-statement').set(headers('MEMBER')).query({ memberId }).expect(403);
  });
});
