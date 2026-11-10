import { test, expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../../backend/src/utils/password';
import { syncRoles } from '../../backend/src/services/roles';
const local = parse(readFileSync('backend/.env'));
const databaseUrl = process.env.TEST_DATABASE_URL ?? local.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test')) throw new Error('Financial browser tests require a separate _test database');
const url = new URL(databaseUrl);
const db = new PrismaClient({ adapter: new PrismaMariaDb({ host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: url.pathname.slice(1), connectionLimit: 2, allowPublicKeyRetrieval: ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) }) });
const tag = randomUUID().slice(0, 8); const password = 'FinanceBrowserPassword123';
const emails: Record<string, string> = {}; const userIds: string[] = []; let societyId = ''; let memberId = '';
async function signIn(page: Page, role: string) {
  await page.goto('/login'); await page.getByLabel('Email address', { exact: true }).fill(emails[role]!); await page.getByLabel('Password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: role === 'MEMBER' ? 'My dashboard.' : 'Overview.' })).toBeVisible();
}
async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
}
test.beforeAll(async () => {
  await db.$transaction(tx => syncRoles(tx));
  societyId = (await db.society.create({ data: { code: `FUI-${tag}`, name: `Finance Browser ${tag}` } })).id;
  const passwordHash = await hashPassword(password);
  for (const code of ['ADMIN', 'ACCOUNTANT', 'APPROVER', 'MEMBER']) {
    const role = await db.role.findUniqueOrThrow({ where: { code } }); emails[code] = `${tag}-${code.toLowerCase()}@finance-browser.test`;
    const user = await db.user.create({ data: { name: `Browser ${code}`, email: emails[code]!, passwordHash, mustChangePassword: false, memberships: { create: { societyId, roleId: role.id } } } }); userIds.push(user.id);
    if (code === 'MEMBER') memberId = (await db.member.create({ data: { societyId, memberNo: `FUI-${tag}`, userId: user.id, fullName: `Savings Member ${tag}`, phone: '01700000000', address: 'Dhaka', joinedAt: new Date('2026-01-01') } })).id;
  }
});
test.afterAll(async () => {
  await db.ledgerEntry.deleteMany({ where: { societyId } });
  await db.approvalDecision.deleteMany({ where: { societyId } });
  await db.financialTransaction.deleteMany({ where: { societyId, type: 'REVERSAL' } });
  await db.financialTransaction.deleteMany({ where: { societyId } });
  await db.ledgerAccount.deleteMany({ where: { societyId } });
  await db.financePolicy.deleteMany({ where: { societyId } });
  await db.auditLog.deleteMany({ where: { OR: [{ societyId }, { actorId: { in: userIds } }] } });
  await db.member.deleteMany({ where: { id: memberId } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  if (societyId) await db.society.delete({ where: { id: societyId } });
  await db.$disconnect();
});
test('cash account, deposit request, approval, ledger and private member statement', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await signIn(page, 'ADMIN'); await page.getByRole('link', { name: 'Finance', exact: true }).click();
  await page.getByRole('button', { name: 'Cash & bank accounts', exact: true }).click(); await page.getByRole('button', { name: 'Add account', exact: true }).click();
  const accountDialog = page.getByRole('dialog', { name: 'Add cash or bank account', exact: true });
  await accountDialog.getByLabel('Account code').fill('CASH-01'); await accountDialog.getByLabel('Account name').fill('Office cash'); await accountDialog.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(accountDialog).not.toBeVisible(); await expect(page.getByText('Office cash', { exact: true })).toBeVisible();
  await signOut(page); await signIn(page, 'ACCOUNTANT'); await page.getByRole('link', { name: 'Finance', exact: true }).click();
  await page.getByRole('button', { name: 'New transaction', exact: true }).click();
  const entry = page.getByRole('dialog', { name: 'New transaction', exact: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('finance-entry-mobile.png'), fullPage: true, animations: 'disabled' });
  const entryBounds = await entry.boundingBox(); expect(entryBounds!.width).toBeLessThanOrEqual(390);
  await entry.getByLabel('Member', { exact: true }).selectOption(memberId);
  await entry.getByLabel('Cash or bank account', { exact: true }).selectOption({ label: 'Office cash · ৳ 0.00' });
  await entry.getByLabel('Amount (BDT)').fill('1500.25'); await entry.getByLabel('Receipt / reference (optional)').fill('Receipt 123');
  await entry.getByRole('button', { name: 'Submit for approval', exact: true }).click(); await expect(entry).not.toBeVisible();
  await expect(page.getByText('Pending', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: testInfo.outputPath('finance-pending-desktop.png'), fullPage: true });
  await signOut(page); await signIn(page, 'APPROVER'); await page.getByRole('link', { name: 'Finance', exact: true }).click();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  const detail = page.getByRole('dialog'); await expect(detail.getByText('Receipt 123', { exact: true })).toBeVisible();
  await detail.getByRole('button', { name: 'Approve request', exact: true }).click(); await expect(detail.getByText('Posted', { exact: true })).toBeVisible();
  await detail.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Society ledger', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Member savings', exact: false })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('finance-ledger-desktop.png'), fullPage: true });
  await signOut(page); await signIn(page, 'MEMBER');
  const statement = page.locator('.finance-statement'); await expect(statement.getByText('৳ 1,500.25', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Finance', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('member-statement-mobile.png'), fullPage: true, animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
