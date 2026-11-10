import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { existsSync, readFileSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { parse } from 'dotenv';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { hashPassword } from '../src/utils/password.js';
import { syncRoles } from '../src/services/roles.js';

const envPath = new URL('../.env', import.meta.url);
const local = existsSync(envPath) ? parse(readFileSync(envPath)) : {};
const databaseUrl = process.env.TEST_DATABASE_URL ?? local.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test')) throw new Error('Tenant tests require a separate _test database');
process.env.DATABASE_URL = databaseUrl;
const { app } = await import('../src/app.js');
const { db } = await import('../src/config/database.js');
const { storedFilePath } = await import('../src/services/file-cleanup.js');
const tag = randomUUID().slice(0, 8); const origin = 'http://localhost:5173'; const temporary = 'TenantTemporary123'; const password = 'TenantPermanent123';
const societies: string[] = []; const users: string[] = [];
let a = ''; let b = ''; let superToken = ''; let adminA = ''; let adminB = ''; let dualToken = ''; let dualUserId = ''; let approver = ''; let memberA = ''; let memberB = ''; let photoA = '';
const headers = (token: string, societyId: string) => ({ Authorization: `Bearer ${token}`, Origin: origin, 'X-Society-Id': societyId });
async function login(email: string, initial = false) {
  const result = await request(app).post('/api/auth/login').set('Origin', origin).send({ email, password: initial ? temporary : password }).expect(200);
  if (!initial) return result.body.accessToken as string;
  await request(app).post('/api/auth/password').set({ Authorization: `Bearer ${result.body.accessToken}`, Origin: origin }).send({ currentPassword: temporary, newPassword: password }).expect(204);
  return login(email);
}
const profile = { fullName: 'Tenant Member', phone: '+8801700000000', email: `${tag}-profile@example.test`, address: 'Dhaka, Bangladesh', joinedAt: '2026-11-09', status: 'ACTIVE', nominees: [{ fullName: 'Tenant Nominee', relationship: 'Spouse', phone: '+8801800000000', address: 'Dhaka', sharePercent: '100' }] };

beforeAll(async () => {
  await db.$transaction(tx => syncRoles(tx));
  const superRole = await db.role.findUniqueOrThrow({ where: { code: 'SUPER_ADMIN' } });
  const superUser = await db.user.create({ data: { name: 'Tenant Test Superadmin', email: `${tag}-super@example.test`, passwordHash: await hashPassword(password), mustChangePassword: false, roles: { create: { roleId: superRole.id } } } }); users.push(superUser.id);
  superToken = await login(superUser.email);
  for (const letter of ['A', 'B']) {
    const email = `${tag}-admin-${letter.toLowerCase()}@example.test`;
    const created = await request(app).post('/api/societies').set({ Authorization: `Bearer ${superToken}`, Origin: origin }).send({ name: `Society ${letter} ${tag}`, code: `TENANT-${letter}-${tag}`, admin: { name: `Admin ${letter}`, email, password: temporary } }).expect(201);
    societies.push(created.body.id); users.push((await db.user.findUniqueOrThrow({ where: { email } })).id);
    if (letter === 'A') { a = created.body.id; adminA = await login(email, true); } else { b = created.body.id; adminB = await login(email, true); }
  }
  const adminRole = await db.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
  const memberRole = await db.role.findUniqueOrThrow({ where: { code: 'MEMBER' } });
  const dual = await db.user.create({ data: { name: 'Shared Identity', email: `${tag}-dual@example.test`, passwordHash: await hashPassword(password), mustChangePassword: false, memberships: { create: [{ societyId: a, roleId: adminRole.id }, { societyId: b, roleId: memberRole.id }] } } }); users.push(dual.id); dualUserId = dual.id;
  dualToken = await login(dual.email);
});
afterAll(async () => {
  const documents = await db.memberDocument.findMany({ where: { societyId: { in: societies } } });
  await db.auditLog.deleteMany({ where: { OR: [{ societyId: { in: societies } }, { actorId: { in: users } }] } });
  await db.memberDocument.deleteMany({ where: { societyId: { in: societies } } });
  await db.nominee.deleteMany({ where: { societyId: { in: societies } } });
  await db.member.deleteMany({ where: { societyId: { in: societies } } });
  await db.systemSetting.deleteMany({ where: { societyId: { in: societies } } });
  await db.societyMembership.deleteMany({ where: { societyId: { in: societies } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.society.deleteMany({ where: { id: { in: societies } } });
  for (const doc of documents) await unlink(storedFilePath(doc.storageKey)).catch(() => {});
  await db.$disconnect();
});

describe('multi-society isolation with MySQL', () => {
  it('restricts society management to platform superadmin and creates an admin atomically', async () => {
    await request(app).get('/api/societies').set(headers(adminA, a)).expect(403);
    await request(app).post('/api/societies').set(headers(adminA, a)).send({}).expect(403);
    const list = await request(app).get('/api/societies').set(headers(superToken, a)).expect(200);
    expect(list.body.items.map((s: { id: string }) => s.id)).toEqual(expect.arrayContaining([a, b]));
    await request(app).post('/api/societies').set(headers(superToken, a)).send({ name: 'Must roll back', code: `ROLLBACK-${tag}`, admin: { name: 'Duplicate', email: `${tag}-admin-a@example.test`, password: temporary } }).expect(409);
    expect(await db.society.count({ where: { code: `ROLLBACK-${tag}` } })).toBe(0);
    await request(app).get('/api/members').set({ Authorization: `Bearer ${superToken}` }).expect(400);
  });
  it('keeps duplicate profile emails and member numbers separate by society', async () => {
    const first = await request(app).post('/api/members').set(headers(adminA, a)).send(profile).expect(201); memberA = first.body.id;
    const second = await request(app).post('/api/members').set(headers(adminB, b)).send(profile).expect(201); memberB = second.body.id;
    await db.member.update({ where: { id: memberB }, data: { memberNo: first.body.memberNo, userId: dualUserId } });
    await request(app).post('/api/members').set(headers(adminA, a)).send(profile).expect(409);
    const listA = await request(app).get('/api/members').set(headers(adminA, a)).expect(200);
    const listB = await request(app).get('/api/members').set(headers(adminB, b)).expect(200);
    expect(listA.body.items.map((m: { id: string }) => m.id)).toEqual([memberA]);
    expect(listB.body.items.map((m: { id: string }) => m.id)).toEqual([memberB]);
    const summaryA = await request(app).get('/api/dashboard').set(headers(adminA, a)).expect(200);
    expect(summaryA.body.total).toBe(1); expect(summaryA.body.recent[0].id).toBe(memberA);
    const summaryB = await request(app).get('/api/dashboard').set(headers(adminB, b)).expect(200);
    expect(summaryB.body.total).toBe(1); expect(summaryB.body.recent[0].id).toBe(memberB);
  });
  it('rejects forged society context and cross-society record access, including superadmin context', async () => {
    await request(app).get('/api/members').set(headers(adminA, b)).expect(403);
    await request(app).get('/api/auth/me').set(headers(adminA, b)).expect(403);
    await request(app).get(`/api/members/${memberA}`).set(headers(adminB, b)).expect(404);
    await request(app).get(`/api/members/${memberB}`).set(headers(adminA, a)).expect(404);
    await request(app).get(`/api/members/${memberB}`).set(headers(superToken, a)).expect(404);
    await request(app).get(`/api/members/${memberB}`).set(headers(superToken, b)).expect(200);
    await request(app).put(`/api/members/${memberA}`).set(headers(adminB, b)).send({ ...profile, version: 1 }).expect(404);
    await request(app).delete(`/api/members/${memberA}`).set(headers(adminB, b)).send({ version: 1 }).expect(404);
    await request(app).post(`/api/members/${memberA}/login`).set(headers(adminB, b)).send({ email: `${tag}-wrong@example.test`, password: temporary }).expect(404);
  });
  it('scopes staff lists and role grants; a society admin cannot create a platform superadmin', async () => {
    const staff = await request(app).post('/api/users').set(headers(adminA, a)).send({ name: 'Society A Approver', email: `${tag}-approver@example.test`, password: temporary, roleCode: 'APPROVER' }).expect(201); users.push(staff.body.id);
    approver = await login(`${tag}-approver@example.test`, true);
    await request(app).post('/api/users').set(headers(adminA, a)).send({ name: 'Escalation', email: `${tag}-escalate@example.test`, password: temporary, roleCode: 'SUPER_ADMIN' }).expect(422);
    const listA = await request(app).get('/api/users').set(headers(adminA, a)).expect(200);
    const listB = await request(app).get('/api/users').set(headers(adminB, b)).expect(200);
    expect(listA.body.items.some((u: { id: string }) => u.id === staff.body.id)).toBe(true);
    expect(listB.body.items.some((u: { id: string }) => u.id === staff.body.id)).toBe(false);
    await request(app).get('/api/members').set(headers(approver, a)).expect(200);
    await request(app).get('/api/members').set(headers(approver, b)).expect(403);
    await request(app).post('/api/members').set(headers(approver, a)).send(profile).expect(403);
    await request(app).get('/api/users').set(headers(approver, a)).expect(403);
    expect((await request(app).get('/api/roles').set(headers(adminA, a)).expect(200)).body.some((r: { code: string }) => r.code === 'SUPER_ADMIN')).toBe(false);
  });
  it('resolves permissions per society for the same identity without combining roles', async () => {
    const inA = await request(app).get('/api/auth/me').set(headers(dualToken, a)).expect(200);
    const inB = await request(app).get('/api/auth/me').set(headers(dualToken, b)).expect(200);
    expect(inA.body.roles).toEqual(['ADMIN']); expect(inA.body.permissions).toContain('users.manage');
    expect(inB.body.roles).toEqual(['MEMBER']); expect(inB.body.permissions).not.toContain('users.manage'); expect(inB.body.memberId).toBe(memberB);
    expect(inB.body.societies.map((s: { id: string }) => s.id)).toEqual(expect.arrayContaining([a, b]));
    await request(app).get('/api/users').set(headers(dualToken, a)).expect(200);
    await request(app).get('/api/users').set(headers(dualToken, b)).expect(403);
    await request(app).get('/api/members/me').set(headers(dualToken, b)).expect(200);
    await request(app).get(`/api/members/${memberA}`).set(headers(dualToken, b)).expect(403);
    await request(app).get('/api/societies').set(headers(dualToken, a)).expect(403);
  });
  it('isolates photo read, upload and removal endpoints', async () => {
    const photo = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#236644' } }).png().toBuffer();
    const uploaded = await request(app).post(`/api/members/${memberA}/photo`).set(headers(adminA, a)).attach('photo', photo, { filename: 'tenant.png', contentType: 'image/png' }).expect(201); photoA = uploaded.body.id;
    await request(app).get(`/api/documents/${photoA}`).set(headers(adminA, a)).expect(200);
    await request(app).get(`/api/documents/${photoA}`).set(headers(adminB, b)).expect(404);
    await request(app).get(`/api/documents/${photoA}`).set(headers(dualToken, b)).expect(404);
    await request(app).post(`/api/members/${memberA}/photo`).set(headers(adminB, b)).attach('photo', photo, { filename: 'wrong.png', contentType: 'image/png' }).expect(404);
    await request(app).delete(`/api/members/${memberA}/photo`).set(headers(adminB, b)).send({ documentId: photoA }).expect(404);
    expect((await db.memberDocument.findUniqueOrThrow({ where: { id: photoA } })).societyId).toBe(a);
  });
  it('enforces composite foreign keys even when bypassing HTTP validation', async () => {
    await expect(db.nominee.create({ data: { societyId: b, memberId: memberA, fullName: 'Invalid cross-tenant nominee', relationship: 'Spouse', phone: '01700000000', address: 'Dhaka', sharePercent: '100' } })).rejects.toMatchObject({ code: 'P2003' });
    await expect(db.memberDocument.create({ data: { societyId: b, memberId: memberA, kind: 'OTHER', storageKey: `${tag}-forbidden`, originalName: 'invalid.txt', mimeType: 'text/plain', sizeBytes: 1 } })).rejects.toMatchObject({ code: 'P2003' });
    const adminAUser = await db.user.findUniqueOrThrow({ where: { email: `${tag}-admin-a@example.test` } });
    await expect(db.member.update({ where: { id: memberB }, data: { userId: adminAUser.id } })).rejects.toMatchObject({ code: 'P2003' });
    const memberAudit = await db.auditLog.findMany({ where: { entityId: memberA } });
    expect(memberAudit.length).toBeGreaterThan(0); expect(memberAudit.every(log => log.societyId === a)).toBe(true);
  });
  it('disabling one society blocks its users while other society access remains available', async () => {
    const society = await db.society.findUniqueOrThrow({ where: { id: b } });
    const fields = { name: society.name, code: society.code, email: '', phone: '', address: '' };
    const disabled = await request(app).put(`/api/societies/${b}`).set(headers(superToken, a)).send({ ...fields, version: society.version, isActive: false }).expect(200);
    await request(app).get('/api/members').set(headers(adminB, b)).expect(401);
    await request(app).get('/api/members/me').set(headers(dualToken, b)).expect(403);
    await request(app).get('/api/members').set(headers(adminA, a)).expect(200);
    await request(app).get('/api/users').set(headers(dualToken, a)).expect(200);
    await request(app).get('/api/societies').set(headers(superToken, b)).expect(200);
    await request(app).put(`/api/societies/${b}`).set(headers(superToken, a)).send({ ...fields, version: disabled.body.version, isActive: true }).expect(200);
    await request(app).get('/api/members').set(headers(adminB, b)).expect(200);
  });
  it('archiving membership in one society preserves the same identity’s other society access', async () => {
    const member = await request(app).get(`/api/members/${memberB}`).set(headers(adminB, b)).expect(200);
    await request(app).delete(`/api/members/${memberB}`).set(headers(adminB, b)).send({ version: member.body.version }).expect(204);
    await request(app).get('/api/members/me').set(headers(dualToken, b)).expect(403);
    await request(app).get('/api/users').set(headers(dualToken, a)).expect(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: dualUserId } })).isActive).toBe(true);
  });
});
