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
  await db.ledgerAccount.create({ data: { societyId, code: 'BANK-01', name: 'Reserve account', kind: 'BANK', bankName: 'Local Bank', accountNumberLast4: '4321' } });
  const passwordHash = await hashPassword(password);
  for (const code of ['SOCIETY_ADMIN', 'ACCOUNTANT', 'APPROVER', 'MEMBER']) {
    const role = await db.role.findUniqueOrThrow({ where: { code } }); emails[code] = `${tag}-${code.toLowerCase()}@finance-browser.test`;
    const user = await db.user.create({ data: { name: `Browser ${code}`, email: emails[code]!, passwordHash, mustChangePassword: false, memberships: { create: { societyId, roleId: role.id } } } }); userIds.push(user.id);
    if (code === 'MEMBER') memberId = (await db.member.create({ data: { societyId, memberNo: `FUI-${tag}`, userId: user.id, fullName: `Savings Member ${tag}`, phone: '01700000000', address: 'Dhaka', joinedAt: new Date('2026-01-01') } })).id;
  }
});
test.afterAll(async () => {
  await db.ledgerEntry.deleteMany({ where: { societyId } });
  await db.approvalDecision.deleteMany({ where: { societyId } });
  await db.financialTransaction.updateMany({ where: { societyId }, data: { loanId: null, investmentId: null } });
  await db.loan.deleteMany({ where: { societyId } });
  await db.investment.deleteMany({ where: { societyId } });
  await db.financialTransaction.deleteMany({ where: { societyId, type: 'REVERSAL' } });
  await db.financialTransaction.deleteMany({ where: { societyId } });
  await db.memberSettlement.deleteMany({ where: { societyId } });
  await db.ledgerAccount.deleteMany({ where: { societyId } });
  await db.financePolicy.deleteMany({ where: { societyId } });
  await db.auditLog.deleteMany({ where: { OR: [{ societyId }, { actorId: { in: userIds } }] } });
  await db.member.deleteMany({ where: { id: memberId } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  if (societyId) await db.society.delete({ where: { id: societyId } });
  await db.$disconnect();
});
test('cash account, deposit request, approval, ledger and private member statement', async ({ page, browser }, testInfo) => {
  test.setTimeout(120000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await signIn(page, 'SOCIETY_ADMIN'); await page.getByRole('link', { name: 'Finance', exact: true }).click();
  await page.getByRole('button', { name: 'Cash & bank accounts', exact: true }).click(); await page.getByRole('button', { name: 'Add account', exact: true }).click();
  const accountDialog = page.getByRole('dialog', { name: 'Add cash or bank account', exact: true });
  await accountDialog.getByLabel('Account code').fill('CASH-01'); await accountDialog.getByLabel('Account name').fill('Office cash'); await accountDialog.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(accountDialog).not.toBeVisible(); await expect(page.getByText('Office cash', { exact: true })).toBeVisible();
  await signOut(page); await signIn(page, 'ACCOUNTANT'); await page.getByRole('link', { name: 'Finance', exact: true }).click();
  await page.getByRole('button', { name: 'New transaction', exact: true }).click();
  const entry = page.getByRole('dialog', { name: 'New transaction', exact: true });
  await expect(entry.getByLabel('Transaction type').locator('option')).toHaveText(['Deposit', 'Withdrawal']);
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
  await expect(page.getByRole('link', { name: 'Reports', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('member-statement-mobile.png'), fullPage: true, animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({width:1280,height:720}); await signOut(page); await signIn(page,'ACCOUNTANT');
  const approverContext = await browser.newContext(); const approverPage = await approverContext.newPage(); await signIn(approverPage,'APPROVER');
  const cash = await db.ledgerAccount.findFirstOrThrow({where:{societyId,code:'CASH-01'}});
  const optionsByMenu = {
    loans: ['Loan disbursement', 'Loan repayment'],
    investments: ['Investment purchase', 'Investment return'],
    expenses: ['Expense'],
    income: ['Other income', 'Investment profit'],
  };
  async function approveRequest(transactionNo: string) {
    await approverPage.goto('/approvals');
    const row = approverPage.getByRole('row').filter({ hasText: transactionNo });
    await row.getByRole('button', { name: 'Review', exact: true }).click();
    const review = approverPage.getByRole('dialog', { name: transactionNo, exact: true });
    await review.getByRole('button', { name: 'Approve request', exact: true }).click();
    await expect(review.getByText('Posted', { exact: true })).toBeVisible();
    await review.getByRole('button', { name: 'Close dialog', exact: true }).click();
  }
  async function submitProduct(menu: keyof typeof optionsByMenu, type:string, amount:string, fill:(dialog:ReturnType<typeof page.getByRole>)=>Promise<void>) {
    await page.goto(`/${menu}`); await page.getByRole('button',{name:'New transaction',exact:true}).click(); const dialog=page.getByRole('dialog',{name:'New transaction',exact:true});
    await expect(dialog.getByLabel('Transaction type').locator('option')).toHaveText(optionsByMenu[menu]);
    await dialog.getByLabel('Transaction type',{exact:true}).selectOption(type); await dialog.getByLabel('Cash or bank account',{exact:true}).selectOption(cash.id);
    await fill(dialog); if(type !== 'INVESTMENT_RETURN' || menu === 'income') await dialog.getByLabel('Amount (BDT)').fill(amount);
    await dialog.getByRole('button',{name:'Submit for approval',exact:true}).click(); await expect(dialog).not.toBeVisible();
    const request=await db.financialTransaction.findFirstOrThrow({where:{societyId,type:type as any,status:'PENDING'},orderBy:{createdAt:'desc'}});
    await approveRequest(request.transactionNo);
    return db.financialTransaction.findUniqueOrThrow({where:{id:request.id}});
  }
  const loanRequest=await submitProduct('loans','LOAN_DISBURSEMENT','120.01',async dialog=>{await dialog.getByLabel('Member',{exact:true}).selectOption(memberId);await dialog.getByLabel('Number of monthly installments').fill('3');await dialog.getByLabel('First installment date').fill('2027-01-31');});
  const loanSummary = page.getByRole('region', { name: 'Loan summary', exact: true });
  await page.goto('/loans'); await expect(page.getByRole('cell',{name:'৳ 120.01',exact:true}).first()).toBeVisible();await page.getByRole('button',{name:'View history',exact:true}).click();
  const schedule=page.getByRole('dialog',{name:'Loan schedule & history'}); await expect(schedule.getByRole('cell',{name:'2027-02-28',exact:true})).toBeVisible();await schedule.getByRole('button',{name:'Close dialog',exact:true}).click();
  await submitProduct('loans','LOAN_REPAYMENT','40.00',async dialog=>{await dialog.getByLabel('Loan',{exact:true}).selectOption(loanRequest.loanId!);});
  await page.goto('/loans');
  await expect(loanSummary.locator('article').filter({ hasText: 'Total disbursed' })).toContainText('৳ 120.01');
  await expect(loanSummary.locator('article').filter({ hasText: 'Total repaid' })).toContainText('৳ 40.00');
  await expect(loanSummary.locator('article').filter({ hasText: 'Outstanding principal' })).toContainText('৳ 80.01');
  await expect(page.getByRole('region', { name: 'Financial summary', exact: true })).toHaveCount(0);
  const purchased=await submitProduct('investments','INVESTMENT_PURCHASE','200',async dialog=>{await dialog.getByLabel('Investment title').fill('Community business');await dialog.getByLabel('Counterparty',{exact:true}).fill('Business partner');});
  await submitProduct('investments','INVESTMENT_RETURN','60',async dialog=>{await dialog.getByLabel('Investment',{exact:true}).selectOption(purchased.investmentId!);await dialog.getByLabel('Principal returned (BDT)').fill('50');await dialog.getByLabel('Profit received (BDT)').fill('10');});
  await page.goto('/investments'); await expect(page.getByRole('cell',{name:'৳ 150.00',exact:true})).toBeVisible();await expect(page.getByRole('cell',{name:'৳ 10.00',exact:true})).toBeVisible();
  const investmentSummary = page.getByRole('region', { name: 'Investment summary', exact: true });
  await expect(investmentSummary.locator('article').filter({ hasText: 'Total invested' })).toContainText('৳ 200.00');
  await expect(investmentSummary.locator('article').filter({ hasText: 'Principal returned' })).toContainText('৳ 50.00');
  await expect(investmentSummary.locator('article').filter({ hasText: 'Outstanding principal' })).toContainText('৳ 150.00');
  await expect(investmentSummary.locator('article').filter({ hasText: 'Realized profit' })).toContainText('৳ 10.00');
  await expect(page.getByRole('region', { name: 'Financial summary', exact: true })).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('investments-desktop.png'),fullPage:true});
  await submitProduct('expenses','EXPENSE','25',async dialog=>{await dialog.getByLabel('Expense category').fill('Office');await dialog.getByLabel('Payee',{exact:true}).fill('Stationery supplier');});
  await page.goto('/expenses');
  const expenseSummary = page.getByRole('region', { name: 'Expense summary', exact: true });
  const netExpenses = expenseSummary.locator('article').filter({ has: page.getByText('Net approved expenses', { exact: true }) });
  await expect(netExpenses).toContainText('৳ 25.00');
  await expect(expenseSummary.getByText('Pending expense requests', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Financial summary', exact: true })).toHaveCount(0);
  await page.getByLabel('To date').fill('2026-01-01');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(netExpenses).toContainText('৳ 0.00');
  await page.goto('/bank');await expect(page.getByRole('cell',{name:'৳ 1,255.24',exact:true})).toBeVisible();
  const bankDashboard = page.getByRole('region', { name: 'Cash and bank dashboard', exact: true });
  const closing = bankDashboard.locator('article').filter({ hasText: 'Closing balance' });
  await expect(bankDashboard.locator('article').filter({ hasText: 'Money in' })).toContainText('৳ 1,600.25');
  await expect(bankDashboard.locator('article').filter({ hasText: 'Money out' })).toContainText('৳ 345.01');
  await expect(closing).toContainText('৳ 1,255.24');
  await expect(page.getByRole('region', { name: 'Financial summary', exact: true })).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('bank-summary-desktop.png'),fullPage:true});
  await page.getByLabel('To date').fill('2026-01-01');
  await page.getByRole('button', { name: 'Apply dates', exact: true }).click();
  await expect(closing).toContainText('৳ 0.00');
  await page.getByRole('button', { name: 'Transfer funds', exact: true }).click();
  const transfer = page.getByRole('dialog', { name: 'New transaction', exact: true });
  await expect(transfer.getByLabel('Transaction type').locator('option')).toHaveText(['Transfer']);
  const bank = await db.ledgerAccount.findFirstOrThrow({ where: { societyId, code: 'BANK-01' } });
  await transfer.getByLabel('Cash or bank account', { exact: true }).selectOption(cash.id);
  await transfer.getByLabel('Destination cash or bank account').selectOption(bank.id);
  await transfer.getByLabel('Amount (BDT)').fill('100');
  await transfer.getByRole('button', { name: 'Submit for approval', exact: true }).click();
  await expect(transfer).not.toBeVisible();
  const bankTransfer = await db.financialTransaction.findFirstOrThrow({ where: { societyId, type: 'TRANSFER', status: 'PENDING' } });
  await approveRequest(bankTransfer.transactionNo);
  await submitProduct('income', 'OTHER_INCOME', '32.50', async dialog => {
    await expect(dialog.getByLabel('Member', { exact: true })).toHaveCount(0);
    await expect(dialog.getByLabel('Receipt / reference (optional)')).toHaveCount(0);
    await dialog.getByLabel('Note (optional)').fill('November shop rent');
  });
  await submitProduct('income', 'INVESTMENT_RETURN', '7.50', async dialog => {
    await expect(dialog.getByLabel('Principal returned (BDT)')).toHaveCount(0);
    await dialog.getByLabel('Investment', { exact: true }).selectOption(purchased.investmentId!);
  });
  await expect(page.getByRole('link', { name: 'Income', exact: true })).toHaveAttribute('href', '/income');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  const income = page.getByRole('region', { name: 'Approved income in the selected period' });
  await expect(income.getByText('৳ 50.00', { exact: true })).toBeVisible();
  await expect(income.getByText('৳ 17.50', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'November shop rent' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '৳ 60.00', exact: true })).toHaveCount(0);
  const mixedReturn = page.getByRole('row').filter({ has: page.getByRole('cell', { name: '৳ 10.00', exact: true }) });
  await mixedReturn.getByRole('button', { name: 'Review', exact: true }).click();
  const incomeDetails = page.getByRole('dialog');
  await expect(incomeDetails.getByRole('heading', { name: '৳ 10.00', exact: true })).toBeVisible();
  await expect(incomeDetails.getByRole('definition').filter({ hasText: '৳ 60.00' })).toBeVisible();
  await incomeDetails.getByRole('button', { name: 'Close dialog', exact: true }).click();

  await page.getByRole('link', { name: 'Reports', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reports dashboard' })).toBeVisible();
  const reportTypes = page.getByRole('navigation', { name: 'Report types' });
  for (const [name, amount] of [
    ['Loans', '80.01'], ['Investments', '150.00'], ['Expenses', '25.00'],
    ['Cash & bank', '1,295.24'], ['Member savings', '1,500.25'], ['Income', '50.00'],
  ]) {
    await reportTypes.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('.report-summary').getByText(`৳ ${amount}`, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByRole('cell', { name: 'November shop rent' })).toBeVisible();
  await page.getByLabel('To date').fill('2026-01-01');
  await page.getByRole('button', { name: 'Apply dates', exact: true }).click();
  await expect(page.getByText('No records for this period.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'November shop rent' })).toBeVisible();

  const workbookDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Excel' }).click();
  const workbook = await workbookDownload;
  expect(workbook.suggestedFilename()).toBe(`FUI-${tag}-income-start-end.xlsx`);
  expect(readFileSync(await workbook.path()).subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));

  await reportTypes.getByRole('button', { name: 'Member statement', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download Excel' })).toBeDisabled();
  await page.getByLabel('Find member by name or number').fill(`FUI-${tag}`);
  await page.getByRole('button', { name: 'Search members', exact: true }).click();
  await page.getByLabel('Member', { exact: true }).selectOption(memberId);
  await expect(page.getByRole('region', { name: 'Report totals' })).toContainText(`Savings Member ${tag} · FUI-${tag}`);
  await expect(page.getByRole('region', { name: 'Report totals' })).toContainText('৳ 1,500.25');
  await expect(page.getByRole('region', { name: 'Report totals' })).toContainText('৳ 80.01');
  await expect(page.getByRole('cell', { name: 'Savings deposit', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Loan repayment', exact: true })).toBeVisible();

  const memberDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Excel' }).click();
  expect((await memberDownload).suggestedFilename()).toBe(`FUI-${tag}-member-statement-FUI-${tag}-start-end.xlsx`);

  await page.evaluate(() => { window.print = () => { document.body.dataset.printRequested = 'true'; }; });
  await page.getByRole('button', { name: 'Save as PDF' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-print-requested', 'true');
  await page.emulateMedia({ media: 'print' });
  const printReport = page.locator('.report-print');
  await expect(printReport.getByRole('heading', { name: 'Member statement' })).toBeVisible();
  await expect(printReport.getByText(`Savings Member ${tag} · FUI-${tag}`, { exact: true })).toBeVisible();
  await expect(printReport.getByRole('cell', { name: 'Loan repayment', exact: true })).toBeVisible();
  await expect(page.locator('#app')).toBeHidden();
  const pdf = await page.pdf({ path: testInfo.outputPath('member-statement.pdf'), preferCSSPageSize: true });
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));

  await reportTypes.getByRole('button', { name: 'Loans', exact: true }).click();
  const loanReportTypes = page.getByRole('navigation', { name: 'Loan report types', exact: true });
  await expect(loanReportTypes.getByRole('button', { name: 'Combined', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('columnheader', { name: 'Disbursed (BDT)', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Repaid (BDT)', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Loan disbursement', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Loan repayment', exact: true })).toBeVisible();

  await loanReportTypes.getByRole('button', { name: 'Loan disbursement', exact: true }).click();
  await expect(page.getByLabel('Member', { exact: true })).toHaveValue(memberId);
  await expect(page.getByRole('cell', { name: 'Loan disbursement', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Loan repayment', exact: true })).toHaveCount(0);

  await loanReportTypes.getByRole('button', { name: 'Loan repayment', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Loan repayment', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Loan disbursement', exact: true })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: '40.00', exact: true })).toBeVisible();
  const repaymentDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Excel' }).click();
  expect((await repaymentDownload).suggestedFilename()).toBe(`FUI-${tag}-loan-repayments-FUI-${tag}-start-end.xlsx`);

  await page.evaluate(() => { delete document.body.dataset.printRequested; });
  await page.getByRole('button', { name: 'Save as PDF' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-print-requested', 'true');
  await page.emulateMedia({ media: 'print' });
  await expect(printReport.getByRole('heading', { name: 'Loan repayment report' })).toBeVisible();
  await expect(printReport.getByRole('cell', { name: 'Loan repayment', exact: true })).toBeVisible();
  await expect(printReport.getByRole('cell', { name: 'Loan disbursement', exact: true })).toHaveCount(0);
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));

  await reportTypes.getByRole('button', { name: 'Bank statement', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download Excel' })).toBeDisabled();
  await page.getByLabel('Cash or bank account', { exact: true }).selectOption(bank.id);
  const bankRows = page.getByRole('table').locator('tbody tr');
  await expect(bankRows).toHaveCount(1);
  await expect(bankRows.first()).toContainText(bankTransfer.transactionNo);
  await expect(bankRows.first()).toContainText('Office cash · CASH-01');
  await expect(bankRows.first().getByRole('cell', { name: '100.00', exact: true })).toHaveCount(2);
  const bankDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Excel' }).click();
  expect((await bankDownload).suggestedFilename()).toBe(`FUI-${tag}-bank-statement-BANK-01-start-end.xlsx`);

  await page.evaluate(() => { delete document.body.dataset.printRequested; });
  await page.getByRole('button', { name: 'Save as PDF' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-print-requested', 'true');
  await page.emulateMedia({ media: 'print' });
  await expect(printReport.getByRole('heading', { name: 'Bank statement' })).toBeVisible();
  await expect(printReport.getByText('Reserve account · BANK-01 · Local Bank · ••••4321')).toBeVisible();
  const bankPdf = await page.pdf({ path: testInfo.outputPath('bank-statement.pdf'), preferCSSPageSize: true });
  expect(bankPdf.subarray(0, 5).toString()).toBe('%PDF-');
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));

  await reportTypes.getByRole('button', { name: 'Cash & bank', exact: true }).click();
  await expect(page.getByLabel('Cash or bank account', { exact: true })).toHaveValue(bank.id);
  await expect(page.getByRole('cell', { name: 'Reserve account', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Office cash', exact: true })).toHaveCount(0);
  await page.getByLabel('Cash or bank account', { exact: true }).selectOption('');
  await expect(page.getByRole('cell', { name: 'Office cash', exact: true })).toBeVisible();
  await reportTypes.getByRole('button', { name: 'Bank statement', exact: true }).click();
  await page.getByLabel('Cash or bank account', { exact: true }).selectOption(bank.id);
  await expect(page.getByRole('cell', { name: bankTransfer.transactionNo, exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('reports-mobile.png'), fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.goto('/finance');
  await page.getByRole('button', { name: 'New transaction', exact: true }).click();
  await entry.getByLabel('Member', { exact: true }).selectOption(memberId);
  await entry.getByLabel('Cash or bank account', { exact: true }).selectOption(cash.id);
  await entry.getByLabel('Amount (BDT)').fill('15.25');
  await entry.getByLabel('Receipt / reference (optional)').fill('Duplicate receipt');
  await entry.getByRole('button', { name: 'Submit for approval', exact: true }).click();
  await expect(entry).not.toBeVisible();
  const duplicate = await db.financialTransaction.findFirstOrThrow({ where: { societyId, reference: 'Duplicate receipt' } });
  await approverPage.goto('/approvals');
  await approverPage.getByRole('row').filter({ hasText: duplicate.transactionNo }).getByRole('button', { name: 'Review', exact: true }).click();
  const review = approverPage.getByRole('dialog', { name: duplicate.transactionNo, exact: true });
  await review.getByLabel('Decision').selectOption('REJECT');
  await review.getByLabel('Reason for rejection').fill('The receipt was already recorded.');
  await review.getByRole('button', { name: 'Reject request', exact: true }).click();
  await expect(review.getByText('Rejected', { exact: true })).toBeVisible();
  await expect(review.getByRole('button', { name: 'Delete rejected transaction' })).toHaveCount(0);

  await signOut(page); await signIn(page, 'SOCIETY_ADMIN');
  await page.getByRole('link', { name: 'Finance', exact: true }).click();
  const duplicateRow = page.getByRole('row').filter({ hasText: duplicate.transactionNo });
  await duplicateRow.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: 'Delete rejected transaction', exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete rejected transaction?', exact: true }).getByRole('button', { name: 'Delete transaction', exact: true }).click();
  await expect(duplicateRow).toHaveCount(0);
  await page.getByRole('button', { name: 'Transaction log', exact: true }).click();
  await page.getByLabel('Transaction number').fill(duplicate.transactionNo);
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: duplicate.transactionNo })).toHaveCount(3);
  await expect(page.getByRole('cell', { name: 'Deleted', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'The receipt was already recorded.', exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Activity log', exact: true }).click();
  await page.getByLabel('Performed by role').selectOption('APPROVER');
  await page.getByLabel('Action', { exact: true }).selectOption('FINANCE_REJECTED');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  const rejection = page.getByRole('row').filter({ hasText: duplicate.transactionNo });
  await expect(rejection).toContainText('Rejected a transaction');
  await expect(rejection).toContainText('Browser APPROVER');

  await signOut(page);await signIn(page,'MEMBER');await expect(page.getByRole('cell',{name:'৳ 80.01',exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:testInfo.outputPath('member-loans-mobile.png'),fullPage:true,animations:'disabled'});
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Activity log', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Viewed a member profile', exact: true }).first()).toBeVisible();
  await expect(page.getByLabel('Activity scope')).toHaveCount(0);
  await expect(page.getByRole('cell', { name: /Browser APPROVER/ })).toHaveCount(0);
  await approverPage.goto('/activity');
  await expect(approverPage.getByRole('row').filter({ hasText: duplicate.transactionNo }).filter({ hasText: 'Rejected a transaction' })).toBeVisible();
  await expect(approverPage.getByLabel('Activity scope')).toHaveCount(0);
  await expect(approverPage.getByRole('cell', { name: /Browser MEMBER/ })).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 720 });
  await signOut(page);
  await signIn(page, 'SOCIETY_ADMIN');
  await submitProduct('income', 'OTHER_INCOME', '225', async dialog => {
    await dialog.getByLabel('Note (optional)').fill('Community hall rent received');
  });
  await page.goto(`/members/${memberId}`);
  const settlement = page.getByRole('region', { name: 'Final settlement' });
  await expect(settlement.getByRole('listitem').filter({ hasText: 'Somity pays member' })).toContainText('৳ 1,500.25');
  await expect(settlement.getByRole('listitem').filter({ hasText: 'Member pays Somity' })).toContainText('৳ 80.01');
  const startButton = settlement.getByRole('button', { name: 'Start final settlement' });
  const startDialog = page.getByRole('dialog', { name: 'Start final settlement?' });
  await startButton.click();
  await startDialog.getByRole('button', { name: 'Go back' }).click();
  await page.reload();
  await expect(startButton).toBeVisible();
  await expect(settlement.getByRole('button', { name: 'Record repayment' })).toHaveCount(0);

  async function confirmStart() {
    await startButton.click();
    await startDialog.getByRole('button', { name: 'Confirm start' }).click();
    await expect(startDialog).not.toBeVisible();
  }

  await confirmStart();
  await settlement.getByRole('button', { name: 'Cancel final settlement' }).click();
  await page.getByRole('dialog', { name: 'Cancel this settlement?' }).getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(settlement.getByText('Settlement cancelled. Regular member transactions can resume.')).toBeVisible();
  await confirmStart();

  async function recordSettlementPayment(button: string, dialogName: string, amount: string, reference: string) {
    await settlement.getByRole('button', { name: button, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: dialogName, exact: true });
    await expect(dialog.getByLabel('Payment amount (BDT)')).toHaveValue(amount);
    await dialog.getByLabel('Cash or bank account').selectOption(cash.id);
    await dialog.getByLabel('Receipt or reference').fill(reference);
    await dialog.getByRole('button', { name: 'Submit payment' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(settlement.getByRole('listitem').filter({ hasText: reference })).toContainText('Pending');
    await expect(settlement.getByRole('button', { name: 'Close membership' })).toHaveCount(0);
    const transaction = await db.financialTransaction.findFirstOrThrow({ where: { societyId, reference } });
    await approveRequest(transaction.transactionNo);
    await settlement.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(settlement.getByRole('listitem').filter({ hasText: reference })).toContainText('Posted');
  }

  await recordSettlementPayment('Record repayment', 'Record loan repayment', '80.01', 'Final loan receipt');
  await recordSettlementPayment('Record refund', 'Record savings refund', '1500.25', 'Final savings payout');
  const closeButton = settlement.getByRole('button', { name: 'Close membership' });
  const closeDialog = page.getByRole('dialog', { name: 'Close this membership?' });
  await closeButton.click();
  await closeDialog.getByRole('button', { name: 'Go back' }).click();
  await expect(closeButton).toBeVisible();
  await closeButton.click();
  await closeDialog.getByRole('button', { name: 'Close membership' }).click();
  await expect(page.getByText('Final settlement completed and membership closed.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(settlement.getByText(/Membership closed on/)).toBeVisible();
  await expect(settlement.getByText('Final savings payout', { exact: false })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('final-settlement-mobile.png'), fullPage: true, animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await settlement.getByRole('button', { name: 'View dues statement' }).click();
  const dues = page.getByRole('dialog', { name: 'Dues and receivables' });
  const savingsTotals = dues.getByRole('article').filter({ hasText: 'Somity owes the member' });
  const loanTotals = dues.getByRole('article').filter({ hasText: 'Member owes Somity' });
  await expect(savingsTotals).toContainText('৳ 1,500.25');
  await expect(loanTotals).toContainText('৳ 120.01');
  const statementEntries = dues.getByRole('listitem');
  await expect(statementEntries.filter({ hasText: 'Receipt 123' })).toContainText('Savings deposit');
  const amountPaidBySociety = statementEntries.filter({ hasText: 'Final savings payout' }).locator('dl > div').filter({ hasText: 'Somity paid' });
  await expect(amountPaidBySociety.getByText('৳ 1,500.25', { exact: true })).toBeVisible();
  const amountPaidByMember = statementEntries.filter({ hasText: 'Final loan receipt' }).locator('dl > div').filter({ hasText: 'Member paid' });
  await expect(amountPaidByMember.getByText('৳ 80.01', { exact: true })).toBeVisible();
  await dues.getByLabel('To date').fill('2026-01-01');
  await dues.getByRole('button', { name: 'Apply dates' }).click();
  await expect(dues.getByText('No posted member transactions in this period.')).toBeVisible();
  await dues.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'বাংলা', exact: true }).click();
  await page.getByRole('button', { name: 'দেনা–পাওনার হিসাব দেখুন' }).click();
  const banglaDues = page.getByRole('dialog', { name: 'দেনা–পাওনার বিস্তারিত হিসাব' });
  await expect(banglaDues.getByRole('heading', { name: 'সদস্য সমিতির কাছে পাবেন' })).toBeVisible();
  await expect(banglaDues.getByText('খাতায় অন্তর্ভুক্ত সদস্য লেনদেন')).toBeVisible();
  await banglaDues.screenshot({ path: testInfo.outputPath('member-dues-bangla-mobile.png'), animations: 'disabled' });
  await approverContext.close();
  expect(errors).toEqual([]);
});
