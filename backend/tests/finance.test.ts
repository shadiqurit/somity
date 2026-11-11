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
  for (const roleCode of ['ADMIN', 'ACCOUNTANT', 'APPROVER', 'MEMBER']) {
    const role = await db.role.findUniqueOrThrow({ where: { code: roleCode } });
    const user = await db.user.create({ data: { name: `Finance ${roleCode}`, email: `${tag}-${roleCode.toLowerCase()}@finance.test`, passwordHash, mustChangePassword: false, memberships: { create: [{ societyId, roleId: role.id }, ...(roleCode === 'ADMIN' ? [{ societyId: otherSocietyId, roleId: role.id }] : [])] } } });
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
  await db.ledgerAccount.deleteMany({ where: scoped });
  await db.financePolicy.deleteMany({ where: scoped });
  await db.auditLog.deleteMany({ where: { OR: [scoped, { actorId: { in: users } }] } });
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
    const fund = await submit(input('DEPOSIT', '1000')); expect((await approve(fund.body.id)).status).toBe(200);
    const pending = await send({ type: 'LOAN_DISBURSEMENT', memberId, amount: '100.01', installmentCount: 3, firstDueDate: '2027-01-31' });
    expect(await db.loan.count({ where: { societyId } })).toBe(0);
    const disbursement = await approve(pending.body.id); expect(disbursement.status).toBe(200); const loanId = disbursement.body.loanId;
    const loan = await request(app).get(`/api/finance/loans/${loanId}`).set(headers('ADMIN')).expect(200);
    expect(loan.body.outstanding).toBe('100.01'); expect(loan.body.installments.map((r: { amount: string }) => r.amount)).toEqual(['33.33','33.33','33.35']);
    const repayment = await send({ type: 'LOAN_REPAYMENT', loanId, amount: '20.01' }); expect((await approve(repayment.body.id)).status).toBe(200);
    expect((await request(app).get(`/api/finance/loans/${loanId}`).set(headers('ADMIN')).expect(200)).body.outstanding).toBe('80.00');
    const tooMuch = await send({ type: 'LOAN_REPAYMENT', loanId, amount: '81' }); expect((await approve(tooMuch.body.id)).status).toBe(409);
    const investment = await send({ type: 'INVESTMENT_PURCHASE', amount: '200', title: 'Test partnership', counterparty: 'Test business' });
    const purchase = await approve(investment.body.id); expect(purchase.status).toBe(200); const investmentId = purchase.body.investmentId;
    await request(app).post('/api/finance/transactions').set(headers('ACCOUNTANT')).set('Idempotency-Key', randomUUID()).send({ type:'INVESTMENT_RETURN', investmentId, cashAccountId:cashId, effectiveDate:'2026-11-09', amount:'61', principalReturned:'50', profit:'10' }).expect(422);
    const returned = await send({ type: 'INVESTMENT_RETURN', investmentId, amount: '60', principalReturned: '50', profit: '10' }); expect((await approve(returned.body.id)).status).toBe(200);
    const investmentReport = await request(app).get(`/api/finance/investments/${investmentId}`).set(headers('ADMIN')).expect(200); expect(investmentReport.body.outstanding).toBe('150.00'); expect(investmentReport.body.profit).toBe('10.00');
    const overReturn = await send({ type:'INVESTMENT_RETURN', investmentId, amount:'151', principalReturned:'151', profit:'0' }); expect((await approve(overReturn.body.id)).status).toBe(409);
    const expense = await send({ type: 'EXPENSE', amount: '30', category: 'Rent', payee: 'Landlord' }); expect((await approve(expense.body.id)).status).toBe(200);
    const bank = await db.ledgerAccount.findFirstOrThrow({ where: { societyId, code:'BANK-01' } });
    const transfer = await send({ type: 'TRANSFER', amount: '100', destinationAccountId: bank.id }); expect((await approve(transfer.body.id)).status).toBe(200);
    const report = await request(app).get('/api/finance/bank-summary').set(headers('ADMIN')).expect(200);
    expect(report.body.expenses).toBe('30.00'); expect(report.body.items.find((r:{id:string})=>r.id===cashId).closing).toBe('680.35'); expect(report.body.items.find((r:{id:string})=>r.id===bank.id).closing).toBe('100.00');
    const own = await request(app).get('/api/finance/loans/me').set(headers('MEMBER')).expect(200); expect(own.body.items.map((r:{id:string})=>r.id)).toContain(loanId);
    await request(app).get(`/api/finance/loans/me/${loanId}`).set(headers('MEMBER')).expect(200);
    await request(app).get(`/api/finance/loans/${loanId}`).set(headers('ADMIN',otherSocietyId)).expect(404);
    await request(app).get('/api/finance/investments').set(headers('MEMBER')).expect(403);
    const ownSavings = await request(app).get('/api/finance/statements/me').set(headers('MEMBER')).expect(200); expect(ownSavings.body.closingBalance).toBe('1030.35');
    const reverse = async (id:string) => { const r=await request(app).post(`/api/finance/transactions/${id}/reversal`).set(headers('ACCOUNTANT')).set('Idempotency-Key',randomUUID()).send({effectiveDate:'2026-11-09',note:'Correct business posting'}).expect(201); return approve(r.body.id); };
    expect((await reverse(expense.body.id)).status).toBe(200); expect((await reverse(returned.body.id)).status).toBe(200);
    const restored = await request(app).get(`/api/finance/investments/${investmentId}`).set(headers('ADMIN')).expect(200); expect(restored.body.outstanding).toBe('200.00');expect(restored.body.profit).toBe('0.00');
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
    const afterPeriod=await request(app).get('/api/finance/bank-summary').query({from:'2026-11-10'}).set(headers('ADMIN')).expect(200);expect(afterPeriod.body.items.every((r:{opening:string;closing:string;deposits:string;withdrawals:string})=>r.opening===r.closing&&r.deposits==='0.00'&&r.withdrawals==='0.00')).toBe(true);
  });
});
