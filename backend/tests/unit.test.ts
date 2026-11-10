import { describe, expect, it } from 'vitest';
import { canViewMember, hasPermission } from '../src/middleware/auth.js';
import { hashPassword, verifyPassword } from '../src/utils/password.js';
import { memberSchema, sharesTotal100 } from '../src/modules/members/member.validator.js';
import { storedFilePath, storageRoot } from '../src/services/file-cleanup.js';
import { resolve } from 'node:path';
import { databaseConnectionOptions } from '../src/config/database.js';
import { balancedLines } from '../src/modules/finance/finance.service.js';
import { moneySchema } from '../src/modules/finance/finance.validator.js';
import { Prisma } from '@prisma/client';

describe('financial precision', () => {
  it('rejects floats, zero, negative, exponent and excess precision inputs', () => {
    for (const amount of [0.1, '0', '-1', '1e3', '01.00', '1.001', 'NaN', 'abc', '1,000', '', null, '1000000000000000000']) expect(moneySchema.safeParse(amount).success).toBe(false);
    expect(moneySchema.safeParse('999999999999999999.99').success).toBe(true);
  });
  it('preserves exact cents and balances deposits and withdrawals', () => {
    const amount = new Prisma.Decimal('999999999999999999.99');
    expect(amount.plus('0.02').toFixed(2)).toBe('1000000000000000000.01');
    for (const increasesSavings of [true, false]) {
      const lines = balancedLines(amount, 'cash', 'savings', increasesSavings);
      expect(lines.reduce((sum, line) => sum.plus(line.debit), new Prisma.Decimal(0)).toFixed(2)).toBe(amount.toFixed(2));
      expect(lines.reduce((sum, line) => sum.plus(line.credit), new Prisma.Decimal(0)).toFixed(2)).toBe(amount.toFixed(2));
      expect(lines.every(line => line.debit.isZero() !== line.credit.isZero())).toBe(true);
    }
    expect(() => balancedLines(new Prisma.Decimal('0.001'), 'cash', 'savings', true)).toThrow();
  });
});

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
