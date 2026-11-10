import { test, expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../../backend/src/utils/password';
import { syncRoles } from '../../backend/src/services/roles';
const local = existsSync('backend/.env') ? parse(readFileSync('backend/.env')) : {};
const databaseUrl = process.env.TEST_DATABASE_URL ?? local.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test')) throw new Error('E2E requires an isolated _test database');
const url = new URL(databaseUrl);
const db = new PrismaClient({ adapter: new PrismaMariaDb({ host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: url.pathname.slice(1), connectionLimit: 2 }) });
const tag = randomUUID().slice(0, 8); const rootEmail = `society-root-${tag}@example.test`; const temp = 'SocietyTemporary123'; const password = 'SocietyPermanent123';
const societyIds: string[] = []; const userIds: string[] = []; let rootId = '';
async function signIn(page: Page, email: string, first = false) {
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(first ? temp : password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  if (first) {
    await page.getByLabel('Current password').fill(temp); await page.getByLabel('New password', { exact: true }).fill(password); await page.getByLabel('Confirm new password').fill(password);
    await page.getByRole('button', { name: 'Save password' }).click(); await signIn(page, email);
  }
  await expect(page.getByRole('heading', { name: 'Overview.' })).toBeVisible();
}
test.beforeAll(async () => {
  await db.$transaction(tx => syncRoles(tx));
  const role = await db.role.findUniqueOrThrow({ where: { code: 'SUPER_ADMIN' } });
  rootId = (await db.user.create({ data: { name: 'Society Test Superadmin', email: rootEmail, passwordHash: await hashPassword(password), mustChangePassword: false, roles: { create: { roleId: role.id } } } })).id;
});
test.afterAll(async () => {
  const generated = await db.user.findMany({ where: { email: { in: [rootEmail, `society-a-${tag}@example.test`, `society-b-${tag}@example.test`, `society-approver-${tag}@example.test`] } }, select: { id: true } });
  userIds.push(...generated.map(u => u.id), rootId);
  const societies = await db.society.findMany({ where: { code: { in: [`UI-A-${tag}`.toUpperCase(), `UI-B-${tag}`.toUpperCase()] } }, select: { id: true } }); societyIds.push(...societies.map(s => s.id));
  await db.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { societyId: { in: societyIds } }] } });
  await db.memberDocument.deleteMany({ where: { societyId: { in: societyIds } } });
  await db.nominee.deleteMany({ where: { societyId: { in: societyIds } } });
  await db.member.deleteMany({ where: { societyId: { in: societyIds } } });
  await db.societyMembership.deleteMany({ where: { societyId: { in: societyIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.society.deleteMany({ where: { id: { in: societyIds } } });
  await db.$disconnect();
});
test('creates separate societies and isolates admin and approver browser workspaces', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/login'); await signIn(page, rootEmail);
  await page.getByRole('link', { name: 'Societies', exact: true }).click();
  for (const letter of ['A', 'B']) {
    await page.getByRole('button', { name: 'Add society', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Add society', exact: true });
    await form.getByLabel('Society name', { exact: true }).fill(`UI Society ${letter} ${tag}`); await form.getByLabel('Society code').fill(`UI-${letter}-${tag}`);
    await form.getByLabel('Admin full name').fill(`UI Admin ${letter}`); await form.getByLabel('Admin login email').fill(`society-${letter.toLowerCase()}-${tag}@example.test`); await form.getByLabel('Admin temporary password').fill(temp);
    await form.getByRole('button', { name: 'Create society', exact: true }).click(); await expect(form).not.toBeVisible();
    await expect(page.locator('tbody')).toContainText(`UI Society ${letter} ${tag}`);
  }
  const societyA = await db.society.findUniqueOrThrow({ where: { code: `UI-A-${tag}`.toUpperCase() } }); const societyB = await db.society.findUniqueOrThrow({ where: { code: `UI-B-${tag}`.toUpperCase() } });
  await page.screenshot({ path: testInfo.outputPath('societies-platform.png'), fullPage: true });
  await page.getByRole('button', { name: `Open UI Society A ${tag}`, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overview.' })).toBeVisible(); await expect(page.getByLabel('Current society')).toHaveValue(societyA.id);
  await page.getByRole('link', { name: '+ Add member', exact: true }).click();
  const member = page.getByRole('dialog', { name: 'Add member', exact: true });
  await member.getByLabel('Full name', { exact: true }).fill(`Isolated Member ${tag}`); await member.getByLabel('Phone number').fill('+8801700000000'); await member.getByLabel('Address', { exact: true }).fill('Dhaka, Bangladesh');
  await member.getByRole('button', { name: 'Add nominee', exact: true }).click(); const nominee = page.getByRole('dialog', { name: 'Add nominee', exact: true });
  await nominee.getByLabel('Nominee full name').fill('Isolated Nominee'); await nominee.getByLabel('Relationship').fill('Spouse'); await nominee.getByLabel('Nominee phone').fill('+8801800000000'); await nominee.getByLabel('Nominee address').fill('Dhaka');
  await nominee.getByRole('button', { name: 'Add to nominee list' }).click(); await member.getByRole('button', { name: 'Create member', exact: true }).click(); await expect(member).not.toBeVisible();
  await expect(page.locator('tbody')).toContainText(`Isolated Member ${tag}`);
  const memberA = await db.member.findFirstOrThrow({ where: { societyId: societyA.id, fullName: `Isolated Member ${tag}` } });
  await page.getByLabel('Current society').selectOption(societyB.id); await expect(page.getByRole('heading', { name: 'Overview.' })).toBeVisible();
  await page.getByRole('link', { name: 'Members', exact: true }).click(); await expect(page.getByRole('heading', { name: 'No members yet' })).toBeVisible();
  await page.goto(`/members/${memberA.id}`); await expect(page.getByRole('alert')).toContainText('Member not found'); await expect(page.getByRole('heading', { name: `Isolated Member ${tag}`, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await signIn(page, `society-a-${tag}@example.test`, true);
  await expect(page.getByLabel('Current society')).toHaveValue(societyA.id); await expect(page.getByLabel('Current society').locator('option')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Societies', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Team & access', exact: true }).click(); await page.getByRole('button', { name: 'Add staff account', exact: true }).click();
  const staff = page.getByRole('dialog', { name: 'Add staff account', exact: true });
  await staff.getByLabel('Full name').fill('UI Society A Approver'); await staff.getByLabel('Login email').fill(`society-approver-${tag}@example.test`); await staff.getByLabel('Access role').selectOption('APPROVER'); await staff.getByLabel('Temporary password').fill(temp);
  expect(await staff.getByLabel('Access role').locator('option').allTextContents()).not.toContain('Super Admin');
  await staff.getByRole('button', { name: 'Create account', exact: true }).click(); await expect(staff).not.toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await signIn(page, `society-approver-${tag}@example.test`, true);
  await page.getByRole('link', { name: 'Members', exact: true }).click(); await expect(page.locator('tbody')).toContainText(`Isolated Member ${tag}`);
  await expect(page.getByRole('button', { name: '+ Add member', exact: true })).toHaveCount(0); await expect(page.getByRole('link', { name: 'Team & access', exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('society-approver.png'), fullPage: true });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await signIn(page, `society-b-${tag}@example.test`, true);
  await expect(page.getByLabel('Current society')).toHaveValue(societyB.id);
  await page.getByRole('link', { name: 'Members', exact: true }).click(); await expect(page.getByRole('heading', { name: 'No members yet' })).toBeVisible();
  expect(errors).toEqual([]);
});
