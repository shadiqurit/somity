import { describe, expect, it } from 'vitest';
import { canViewMember, hasPermission } from '../src/middleware/auth.js';
import { hashPassword, verifyPassword } from '../src/utils/password.js';
import { memberSchema, sharesTotal100 } from '../src/modules/members/member.validator.js';
import { storedFilePath, storageRoot } from '../src/services/file-cleanup.js';
import { resolve } from 'node:path';
import { databaseConnectionOptions } from '../src/config/database.js';

describe('database authentication', () => {
  it('allows MySQL RSA key retrieval only for loopback connections', () => {
    for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
      const options = databaseConnectionOptions(`mysql://local:p%40ss@${host}:13316/somity`);
      expect(options.allowPublicKeyRetrieval).toBe(true);
      expect(options.port).toBe(13316);
      expect(options.password).toBe('p@ss');
    }
    for (const host of ['db.example.com', '192.168.1.10', 'localhost.example.com']) {
      expect(databaseConnectionOptions(`mysql://user:pass@${host}/somity`).allowPublicKeyRetrieval).toBe(false);
    }
  });
});
describe('private storage boundaries', () => {
  it('rejects paths outside storage and only accepts flat storage keys', () => {
    expect(storedFilePath('photo.jpg')).toBe(resolve(storageRoot, 'photo.jpg'));
    for (const key of ['', '../photo.jpg', '..\\photo.jpg', 'nested/photo.jpg', 'C:\\outside.jpg']) expect(() => storedFilePath(key)).toThrow();
  });
});
describe('permissions', () => {
  it('limits members to their own record and denies writes', () => {
    const member = { memberId: 'a', permissions: ['profile.read'] };
    expect(canViewMember(member, 'a')).toBe(true);
    expect(canViewMember(member, 'b')).toBe(false);
    expect(hasPermission(member, 'members.write')).toBe(false);
    expect(canViewMember({ memberId: null, permissions: [] }, 'a')).toBe(false);
    expect(canViewMember({ memberId: null, permissions: ['members.read'] }, 'a')).toBe(true);
  });
});
describe('nominee shares', () => {
  it('totals exact hundredths and validates precision', () => {
    expect(sharesTotal100(['33.33', '33.33', '33.34'])).toBe(true);
    expect(sharesTotal100(['50', '49.99'])).toBe(false);
    expect(sharesTotal100(['100.01'])).toBe(false);
    expect(memberSchema.safeParse({ fullName: 'Example Member', phone: '+8801700000000', address: 'Dhaka', joinedAt: '2026-11-09', nominees: [{ fullName: 'Example Nominee', relationship: 'Spouse', phone: '+8801800000000', address: 'Dhaka', sharePercent: '100.001' }] }).success).toBe(false);
  });
});
describe('password storage', () => {
  it('salts hashes and rejects wrong passwords', async () => {
    const first = await hashPassword('LongSecretPassword123');
    const second = await hashPassword('LongSecretPassword123');
    expect(first).not.toBe(second);
    expect(await verifyPassword('LongSecretPassword123', first)).toBe(true);
    expect(await verifyPassword('wrong-password', first)).toBe(false);
  });
});
