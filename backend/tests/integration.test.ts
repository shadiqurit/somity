import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { parse } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { access, mkdir, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { hashPassword } from '../src/utils/password.js';
import { permissionCodes, roleDefinitions } from '../src/config/permissions.js';

const envPath = new URL('../.env', import.meta.url);
const local = existsSync(envPath) ? parse(readFileSync(envPath)) : {};
const url = process.env.TEST_DATABASE_URL ?? local.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL must name a separate database ending in _test');
process.env.DATABASE_URL = url;
const { app } = await import('../src/app.js');
const { db } = await import('../src/config/database.js');
const { storageRoot } = await import('../src/modules/uploads/upload.service.js');
const { cleanupFiles, storedFilePath } = await import('../src/services/file-cleanup.js');
const origin = 'http://localhost:5173'; const tag = randomUUID().slice(0, 8);
const userIds: string[] = []; const memberIds: string[] = []; const keys: string[] = [];
const password = 'IntegrationPassword123'; const newPassword = 'UpdatedPassword12345';
let societyId = ''; let approverToken = ''; let superToken = ''; let adminToken = ''; let memberToken = ''; let temporaryToken = ''; let memberId = ''; let secondMemberId = ''; let refreshCookie = ''; let photoId = ''; let oldVersion = 1;
const auth = (token: string) => ({ Authorization: `Bearer ${token}`, Origin: origin, 'X-Society-Id': societyId });
const input = { fullName: 'Integration Member', phone: '+8801700000000', email: `${tag}-profile@example.test`, address: 'Dhaka, Bangladesh', joinedAt: '2026-11-09', status: 'ACTIVE', nominees: [{ fullName: 'Nominee One', relationship: 'Spouse', phone: '+8801800000000', address: 'Dhaka', sharePercent: '100' }] };
const cookies = (res: request.Response) => (res.headers['set-cookie'] as unknown as string[]).map(v => v.split(';')[0]).join('; ');

beforeAll(async () => {
  societyId = (await db.society.create({ data: { name: `Integration ${tag}`, code: `IT-${tag}` } })).id;
  for (const code of permissionCodes) await db.permission.upsert({ where: { code }, update: {}, create: { code } });
  for (const [code, definition] of Object.entries(roleDefinitions)) {
    const role = await db.role.upsert({ where: { code }, update: {}, create: { code, name: definition.name } });
    for (const permissionCode of definition.permissions) {
      const permission = await db.permission.findUniqueOrThrow({ where: { code: permissionCode } });
      await db.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } }, update: {}, create: { roleId: role.id, permissionId: permission.id } });
    }
  }
  for (const roleCode of ['SUPER_ADMIN', 'ADMIN', 'APPROVER']) {
    const role = await db.role.findUniqueOrThrow({ where: { code: roleCode } });
    const user = await db.user.create({ data: { name: `Test ${roleCode}`, email: `${tag}-${roleCode}@example.test`.toLowerCase(), passwordHash: await hashPassword(password), mustChangePassword: false, ...(roleCode === 'SUPER_ADMIN' ? { roles: { create: { roleId: role.id } } } : { memberships: { create: { societyId, roleId: role.id } } }) } });
    userIds.push(user.id);
    const result = await request(app).post('/api/auth/login').set('Origin', origin).send({ email: user.email, password }).expect(200);
    if (roleCode === 'SUPER_ADMIN') superToken = result.body.accessToken; else if (roleCode === 'ADMIN') adminToken = result.body.accessToken; else approverToken = result.body.accessToken;
  }
});
afterAll(async () => {
  const docs = await db.memberDocument.findMany({ where: { memberId: { in: memberIds } } }); keys.push(...docs.map(d => d.storageKey));
  await db.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { entityId: { in: [...userIds, ...memberIds] } }] } });
  await db.memberDocument.deleteMany({ where: { memberId: { in: memberIds } } });
  await db.nominee.deleteMany({ where: { memberId: { in: memberIds } } });
  await db.member.deleteMany({ where: { id: { in: memberIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  for (const key of keys) await unlink(resolve(storageRoot, key)).catch(() => {});
  await db.society.delete({ where: { id: societyId } });
  await db.$disconnect();
});
describe('Phase 1 API with MySQL', () => {
  it('checks credentials, authentication and origin', async () => {
    await request(app).get('/api/members').expect(401);
    await request(app).post('/api/auth/login').send({ email: 'nobody@example.test', password }).expect(403);
    await request(app).post('/api/auth/login').set('Origin', origin).send({ email: 'nobody@example.test', password }).expect(401);
    await request(app).post('/api/auth/refresh').set('Origin', 'https://evil.example').expect(403);
  });
  it('creates members with nominees; rejects duplicate emails and invalid shares', async () => {
    const result = await request(app).post('/api/members').set(auth(adminToken)).send(input).expect(201);
    memberId = result.body.id; memberIds.push(memberId); expect(result.body.nominees[0].sharePercent).toBe('100'); expect(result.body.memberNo).toMatch(/^MEM-/);
    const second = await request(app).post('/api/members').set(auth(adminToken)).send({ ...input, email: `${tag}-second@example.test`, fullName: 'Second Member' }).expect(201);
    secondMemberId = second.body.id; memberIds.push(secondMemberId);
    await request(app).post('/api/members').set(auth(adminToken)).send(input).expect(409);
    await request(app).post('/api/members').set(auth(adminToken)).send({ ...input, nominees: [{ ...input.nominees[0], sharePercent: '80' }] }).expect(422);
  });
  it('supports search and pagination, and protects staff management', async () => {
    const result = await request(app).get('/api/members').query({ search: `${tag}-profile`, pageSize: 1 }).set(auth(adminToken)).expect(200);
    expect(result.body.total).toBe(1); expect(result.body.items[0].id).toBe(memberId);
    await request(app).get('/api/members').query({ page: -1 }).set(auth(adminToken)).expect(422);
    await request(app).get('/api/societies').set(auth(adminToken)).expect(403);
    const roles = await request(app).get('/api/roles').set(auth(superToken)).expect(200); expect(roles.body).toHaveLength(4);
  });
  it('provisions staff only with privileged access and excludes password hashes', async () => {
    const staff = { name: 'Test Accountant', email: `${tag}-accountant@example.test`, password, roleCode: 'ACCOUNTANT' };
    await request(app).post('/api/users').set(auth(approverToken)).send(staff).expect(403);
    const created = await request(app).post('/api/users').set(auth(superToken)).send(staff).expect(201); userIds.push(created.body.id);
    expect(created.body.mustChangePassword).toBe(true); expect(created.body.passwordHash).toBeUndefined();
    await request(app).post('/api/users').set(auth(superToken)).send(staff).expect(409);
    const users = await request(app).get('/api/users').set(auth(superToken)).expect(200);
    expect(users.body.items.find((u: { id: string }) => u.id === created.body.id).passwordHash).toBeUndefined();
  });
  it('creates member login through tenant administration and enforces password change', async () => {
    await request(app).post(`/api/members/${memberId}/login`).set(auth(approverToken)).send({ email: `${tag}-member@example.test`, password }).expect(403);
    const result = await request(app).post(`/api/members/${memberId}/login`).set(auth(superToken)).send({ email: `${tag}-member@example.test`, password }).expect(201); userIds.push(result.body.id);
    const loggedIn = await request(app).post('/api/auth/login').set('Origin', origin).send({ email: `${tag}-member@example.test`, password }).expect(200); temporaryToken = loggedIn.body.accessToken;
    await request(app).get('/api/members/me').set(auth(temporaryToken)).expect(403);
    await request(app).post('/api/auth/password').set(auth(temporaryToken)).send({ currentPassword: password, newPassword }).expect(204);
    await request(app).get('/api/auth/me').set(auth(temporaryToken)).expect(401);
    const changed = await request(app).post('/api/auth/login').set('Origin', origin).send({ email: `${tag}-member@example.test`, password: newPassword }).expect(200); memberToken = changed.body.accessToken; refreshCookie = cookies(changed);
  });
  it('allows member self access while blocking staff APIs and other members', async () => {
    const own = await request(app).get('/api/members/me').set(auth(memberToken)).expect(200); expect(own.body.id).toBe(memberId);
    await request(app).get(`/api/members/${secondMemberId}`).set(auth(memberToken)).expect(403);
    await request(app).get('/api/members').set(auth(memberToken)).expect(403);
    await request(app).post('/api/members').set(auth(memberToken)).send(input).expect(403);
    await request(app).get('/api/dashboard').set(auth(memberToken)).expect(403);
    await request(app).get('/api/users').set(auth(memberToken)).expect(403);
  });
  it('protects photos, checks actual file bytes and handles upload limits', async () => {
    const photo = await sharp({ create: { width: 12, height: 12, channels: 3, background: '#235b45' } }).png().toBuffer();
    const result = await request(app).post(`/api/members/${memberId}/photo`).set(auth(adminToken)).attach('photo', photo, { filename: 'photo.png', contentType: 'image/png' }).expect(201); photoId = result.body.id;
    await request(app).get(`/api/documents/${photoId}`).set(auth(memberToken)).expect('Content-Type', /image\/jpeg/).expect(200);
    const otherPhoto = await request(app).post(`/api/members/${secondMemberId}/photo`).set(auth(adminToken)).attach('photo', photo, { filename: 'other.png', contentType: 'image/png' }).expect(201);
    await request(app).get(`/api/documents/${otherPhoto.body.id}`).set(auth(memberToken)).expect(403);
    await request(app).get(`/api/documents/${photoId}`).expect(401);
    await request(app).post(`/api/members/${memberId}/photo`).set(auth(adminToken)).attach('photo', Buffer.from('not a photo'), { filename: 'fake.png', contentType: 'image/png' }).expect(422);
    await request(app).post(`/api/members/${memberId}/photo`).set(auth(memberToken)).attach('photo', photo, 'photo.png').expect(403);
    await request(app).post(`/api/members/${memberId}/photo`).set(auth(adminToken)).attach('photo', Buffer.alloc(5 * 1024 * 1024 + 1), { filename: 'large.png', contentType: 'image/png' }).expect(422);
  });
  it('replaces photo metadata and old bytes, retaining the current photo on invalid uploads', async () => {
    const old = await db.memberDocument.findUniqueOrThrow({ where: { id: photoId } });
    await access(storedFilePath(old.storageKey));
    const photo = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#aaccee' } }).png().toBuffer();
    const replacement = await request(app).post(`/api/members/${memberId}/photo`).set(auth(adminToken)).attach('photo', photo, { filename: 'replacement.png', contentType: 'image/png' }).expect(201);
    photoId = replacement.body.id;
    expect(await db.memberDocument.findUnique({ where: { id: old.id } })).toBeNull();
    await expect(access(storedFilePath(old.storageKey))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await db.fileDeletion.findUnique({ where: { storageKey: old.storageKey } })).toBeNull();
    await request(app).get(`/api/documents/${old.id}`).set(auth(adminToken)).expect(404);
    await request(app).delete(`/api/members/${memberId}/photo`).set(auth(adminToken)).send({ documentId: old.id }).expect(409);
    const current = await db.memberDocument.findUniqueOrThrow({ where: { id: photoId } });
    await request(app).post(`/api/members/${memberId}/photo`).set(auth(adminToken)).attach('photo', Buffer.from('invalid bytes'), { filename: 'invalid.png', contentType: 'image/png' }).expect(422);
    expect(await db.memberDocument.count({ where: { memberId, kind: 'PHOTO' } })).toBe(1);
    await access(storedFilePath(current.storageKey));
    await request(app).get(`/api/documents/${photoId}`).set(auth(memberToken)).expect(200);
  });
  it('serializes concurrent replacements without retaining superseded photo files', async () => {
    const before = new Set(await readdir(storageRoot));
    const photo = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#ffaa55' } }).png().toBuffer();
    const results = await Promise.all([1, 2].map(() => request(app).post(`/api/members/${memberId}/photo`).set(auth(adminToken)).attach('photo', photo, { filename: 'concurrent.png', contentType: 'image/png' }).expect(201)));
    const current = await db.memberDocument.findMany({ where: { memberId, kind: 'PHOTO' } });
    expect(current).toHaveLength(1); photoId = current[0]!.id;
    expect(results.map(result => result.body.id)).toContain(photoId);
    expect((await readdir(storageRoot)).filter(key => !before.has(key))).toEqual([current[0]!.storageKey]);
    for (const result of results) await request(app).get(`/api/documents/${result.body.id}`).set(auth(adminToken)).expect(result.body.id === photoId ? 200 : 404);
  });
  it('removes photos and bytes with audit history, preserving other documents and permissions', async () => {
    const photo = await db.memberDocument.findUniqueOrThrow({ where: { id: photoId } });
    const key = `${tag}-identity.txt`;
    await writeFile(storedFilePath(key), 'test');
    const identity = await db.memberDocument.create({ data: { memberId, societyId, kind: 'IDENTITY', storageKey: key, originalName: 'identity.txt', mimeType: 'text/plain', sizeBytes: 4 } });
    await request(app).delete(`/api/members/${memberId}/photo`).send({ documentId: photoId }).expect(401);
    await request(app).delete(`/api/members/${memberId}/photo`).set(auth(memberToken)).send({ documentId: photoId }).expect(403);
    await request(app).delete(`/api/members/${memberId}/photo`).set(auth(adminToken)).send({}).expect(422);
    await request(app).delete('/api/members/nonexistent/photo').set(auth(adminToken)).send({ documentId: photoId }).expect(404);
    await access(storedFilePath(photo.storageKey));
    await request(app).delete(`/api/members/${memberId}/photo`).set(auth(adminToken)).send({ documentId: photoId }).expect(204);
    await expect(access(storedFilePath(photo.storageKey))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await db.memberDocument.findUnique({ where: { id: photoId } })).toBeNull();
    expect(await db.memberDocument.findUnique({ where: { id: identity.id } })).not.toBeNull();
    await access(storedFilePath(identity.storageKey));
    const member = await request(app).get(`/api/members/${memberId}`).set(auth(adminToken)).expect(200); expect(member.body.documents).toEqual([]);
    await request(app).get(`/api/documents/${photoId}`).set(auth(memberToken)).expect(404);
    await request(app).delete(`/api/members/${memberId}/photo`).set(auth(adminToken)).send({ documentId: photoId }).expect(204);
    expect(await db.auditLog.count({ where: { entityId: memberId, action: 'MEMBER_PHOTO_REMOVED' } })).toBe(1);
  });
  it('retains failed file deletions for retry and treats already-missing bytes as cleaned', async () => {
    const storageKey = `${tag}-retry.jpg`;
    const path = storedFilePath(storageKey);
    await mkdir(path);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await db.fileDeletion.create({ data: { storageKey } });
      await cleanupFiles([storageKey]);
      expect((await db.fileDeletion.findUniqueOrThrow({ where: { storageKey } })).attempts).toBe(1);
      await rmdir(path);
      await cleanupFiles([storageKey]);
      expect(await db.fileDeletion.findUnique({ where: { storageKey } })).toBeNull();
    } finally { log.mockRestore(); await rmdir(path).catch(() => {}); await cleanupFiles([storageKey]); }
  });
  it('updates atomically, rejects stale versions and records audit history', async () => {
    const current = await request(app).get(`/api/members/${memberId}`).set(auth(adminToken)).expect(200); oldVersion = current.body.version;
    const changed = await request(app).put(`/api/members/${memberId}`).set(auth(adminToken)).send({ ...input, fullName: 'Updated Member', version: oldVersion }).expect(200);
    expect(changed.body.version).toBe(oldVersion + 1);
    await request(app).put(`/api/members/${memberId}`).set(auth(adminToken)).send({ ...input, version: oldVersion }).expect(409);
    expect(await db.auditLog.count({ where: { entityId: memberId, action: 'MEMBER_UPDATED' } })).toBe(1);
    expect(await db.nominee.count({ where: { memberId } })).toBe(1);
  });
  it('rotates refresh tokens, revokes a replayed family and invalidates access', async () => {
    const result = await request(app).post('/api/auth/refresh').set({ Origin: origin, Cookie: refreshCookie }).expect(200); memberToken = result.body.accessToken;
    const nextCookie = cookies(result);
    await request(app).post('/api/auth/refresh').set({ Origin: origin, Cookie: refreshCookie }).expect(401);
    await request(app).post('/api/auth/refresh').set({ Origin: origin, Cookie: nextCookie }).expect(401);
    await request(app).get('/api/members/me').set(auth(memberToken)).expect(401);
    const login = await request(app).post('/api/auth/login').set('Origin', origin).send({ email: `${tag}-member@example.test`, password: newPassword }).expect(200); memberToken = login.body.accessToken;
  });
  it('archives without deleting history and blocks member sessions', async () => {
    await request(app).delete(`/api/members/${memberId}`).set(auth(adminToken)).send({ version: oldVersion }).expect(409);
    await request(app).delete(`/api/members/${memberId}`).set(auth(adminToken)).send({ version: oldVersion + 1 }).expect(204);
    await request(app).get(`/api/members/${memberId}`).set(auth(adminToken)).expect(404);
    await request(app).get('/api/members/me').set(auth(memberToken)).expect(401);
    expect((await db.member.findUniqueOrThrow({ where: { id: memberId } })).archivedAt).not.toBeNull();
    expect(await db.auditLog.count({ where: { entityId: memberId, action: 'MEMBER_ARCHIVED' } })).toBe(1);
  });
  it('revokes access on logout and exposes database health', async () => {
    const login = await request(app).post('/api/auth/login').set('Origin', origin).send({ email: `${tag}-admin@example.test`, password }).expect(200);
    await request(app).post('/api/auth/logout').set({ Origin: origin, Cookie: cookies(login) }).expect(204);
    await request(app).get('/api/auth/me').set(auth(login.body.accessToken)).expect(401);
    const health = await request(app).get('/api/health').expect(200);
    expect(health.body.capabilities).toEqual({ memberPhotoRemoval: true, supersededPhotoCleanup: true, multiSociety: true, memberFinance: true });
  });
});
