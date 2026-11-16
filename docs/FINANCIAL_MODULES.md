# Member accounts and society finance

The requested modules are available on the existing MySQL server configured in `backend/.env` (this workspace uses port 3306). No `.local` instance is created.

| Module | Current workflow |
| --- | --- |
| Member Profile | Photo, phone, email, address, nominees, savings statement and loan schedule/history. |
| Admin Panel | Member management, staff/member login creation, society-scoped roles and platform society management. |
| Member Login | Read-only access to the signed-in member's own profile, approved savings movements and loans. Members cannot list society finance or access another member's loan ID. |
| Deposit/Withdraw | Entry requests, history, exact BDT amounts, date filters, approvals and approved reversals. |
| Loan | Approved disbursement, principal, monthly installment count/date, repayment requests, outstanding principal, paid/overdue schedule and history. |
| Investment | Approved purchase with title/counterparty; return entry explicitly splits principal returned and realized profit; outstanding principal and profit/history. |
| Income | Other income with an optional note, investment profit receipts, and net approved income for the selected period. |
| Expense | Expense category, payee, amount, date/reference/note, approval, history, reversal and net cost for the selected period. |
| Bank | Cash/bank account setup, approved transfers, date-filtered per-account movements, and combined opening, incoming, outgoing and closing cards. |
| Approval | Maker submits → distinct Approver decides → final approval posts balanced ledger lines. Existing configurable one/two-approver policy and immutable policy snapshots apply to every transaction type. |

## Entering transactions

Admin first adds cash/bank accounts from **Finance → Cash & bank accounts**. Set up an Approver under **Team & access**. Accounts begin at zero; record real deposits before disbursing loans, investing, paying expenses or transferring funds. The default policy prevents the maker from approving their own request.

Open **New transaction** from the sidebar section for the transaction you want to record. Use **Finance** for deposits and withdrawals, **Loans** for disbursements and repayments, **Investments** for purchases and returns, **Income** for other income and investment profit, **Expenses** for expenses, and **Bank** for transfers. Use **Approvals** to review pending requests. Loan and investment records appear after final approval.

In **Income**, choose **Other income** for receipts such as shop rent. Enter the receiving account, date and amount, and describe the receipt in the optional note. Choose **Investment profit** to link a profit-only receipt to a recorded investment. The Income page shows the profit portion of investment returns and includes approved reversals in its date-filtered totals.

Member savings are separate from loan principal: borrowing and repaying a loan does not alter the member's savings liability. Member logins see their own savings statement and **My loans** under **My dashboard**. Staff can also open loans under a member profile. Bank summaries include all posted cash movements, not only member deposits/withdrawals.

The Bank dashboard combines cash and bank accounts. Its incoming and outgoing totals exclude internal transfers and their reversals, while each account row includes its own transfer movements. For a selected period, combined opening plus incoming minus outgoing equals closing.

## Member final settlement

1. On the member profile, open **Final settlement** and review savings due from Somity and principal due from the member on each loan. Resolve any pending member transactions before starting.
2. Select **Start final settlement**, then **Confirm start** to capture current posted dues and direct subsequent payments through the settlement. **Go back** dismisses the confirmation and leaves regular member transactions available.
3. Use **Record repayment** for each loan and **Record refund** for the savings owed. Select the actual cash or bank account and enter the date, amount and any receipt reference. Payments in the two directions are recorded separately. Partial payments are supported, and pending payments reserve their amount until decided.
4. Review the requests in **Approvals** under the existing society policy. Only posted payments count as paid. A posted reversal restores the corresponding amount due while the settlement is open. A refund still requires sufficient funds in the selected account.
5. Refresh the settlement. Once savings and all loan balances are zero and every request is resolved, select and confirm **Close membership**. **Go back** returns to the open settlement. Confirming closure ends the member's portal access and stores the completed settlement with its payment history.

To return to regular member transactions before closure, select **Cancel final settlement** and confirm. Pending requests from that settlement are cancelled. Posted payments stay in the ledger, and a later settlement starts from the current balances.

Super Admin and the assigned Society Admin can start, cancel or close a settlement. Finance staff can read it. Recording and approving payments use the existing finance permissions. Apply the settlement migrations, through `202611170006_member_settlement_cancellation`, before starting the updated API.

Use **View dues statement** in the profile to see posted savings and loan transactions before and after settlement. The date filter shows opening balances, movements in the period and closing balances for both sides. Each row shows the amount paid by each party, the account, reference and both running balances immediately after posting in effective-date order. Reversals appear as opposite movements and identify the original transaction. In the Bangla interface, open **দেনা–পাওনার হিসাব দেখুন**.

## Explicit calculation rules

- Loans currently use **principal-only monthly installments**. No interest, penalty or service charge is invented. Enter the agreed principal, number of installments (1–600) and first due date. Month-end dates clamp to the last day of shorter months; the next month returns to the original day. Exact division uses cents, with the remainder in the final installment. A schedule cannot contain zero-value installments.
- Approved repayments allocate to the earliest unpaid installment. Outstanding principal derives from the loan receivable ledger, including approved repayment reversals. Payment cannot exceed the loan's outstanding principal at the effective date or cause a later negative principal balance. Other loans' balances cannot be used to repay this loan.
- Investment return **amount = principal returned + profit received**. Both parts are nonnegative decimal strings. Profit-only receipts are supported; principal cannot be returned more than once. Reports show realized profit, not estimated returns. Automatic profit distribution to members and loss/write-off posting are not included.
- Expenses debit the expense account and credit the selected cash/bank account. Reversals reduce net expense. Transfers debit the destination cash/bank account and credit the source; they do not create income or member savings.
- All cash/bank, loan and investment principal balances are checked inside the existing serialized society transaction. Duplicate submissions and concurrent approvals cannot double-post. Insufficient funds roll back the final decision and all related product/ledger writes.
- Corrections require approved reversals. A loan disbursement or investment purchase cannot be reversed while its principal is partially repaid/returned; reverse the dependent transactions first. Product rows remain in history with CANCELLED status after a successful original reversal. A reversal cannot itself be reversed.

## Accounting and API

System accounts include LOAN_RECEIVABLE and INVESTMENT_ASSET (assets), INVESTMENT_INCOME and OTHER_INCOME (income), and EXPENSE. Loans and investments use composite society foreign keys. Society income, expenses, investments and transfers can post without a member. Savings and loan transactions require a member. Product terms are captured with the immutable proposed transaction payload.

All operations reuse `POST /api/finance/transactions`, `Idempotency-Key`, decision, cancellation and reversal routes. Additional entry fields:

| Type | Additional required input |
| --- | --- |
| LOAN_DISBURSEMENT | memberId, installmentCount, firstDueDate |
| LOAN_REPAYMENT | loanId (member is resolved from the loan) |
| INVESTMENT_PURCHASE | title, counterparty |
| INVESTMENT_RETURN | investmentId, principalReturned, profit |
| OTHER_INCOME | — |
| EXPENSE | category, payee |
| TRANSFER | destinationAccountId (different active account in the same society) |

All entries require cashAccountId, amount and effectiveDate; reference/note are optional. Staff reports require `finance.read`: `GET /finance/loans`, `/finance/loans/:id`, `/finance/investments`, `/finance/investments/:id`, `/finance/bank-summary`. List routes use page/pageSize; loans can filter memberId. Bank summary accepts from/to. Members use `/finance/loans/me` and `/finance/loans/me/:id`, scoped to their linked member irrespective of supplied query filters. All routes require authentication and an active `X-Society-Id`.

Use `GET /finance/income-summary` with optional `from` and `to` dates for approved income totals. Use `GET /finance/transactions?scope=income` for income requests and reversals.

Super Admin, Admin and Society Admin can manage accounts and policy, submit requests and record decisions within their authorized society. Accountant submits and Approver decides. Members can read their own statement and loans. Decisions must satisfy the captured policy's maker separation and distinct approver rules.

## Upgrade and verification

Migration `202611110001_financial_products` adds loans/investments, transaction metadata/links and account/transaction enum values, and makes member references nullable for society transactions. Existing deposits, withdrawals, decisions and ledger rows remain intact. Back up SQL and uploads before `npm run db:generate` and `npm run db:migrate`. This workspace's pre-upgrade backup is `backups/somity-before-financial-products-2026-11-11/`.

Migration `202611160001_other_income` adds the transaction and ledger account types for other income.

Unit tests verify month-end scheduling and exact installment sums. MySQL tests exercise principal/profit posting, concurrent repayment limits, insufficient funds, reversals, member/tenant isolation, net expenses and bank reconciliation. Browser tests cover entry → independent approver → reports, private member loan views and mobile layout, plus previous member/society workflows. Browser fixtures only use `somity_test`, and are removed afterward. The general API test budget is higher only for NODE_ENV=test; development/production retain 300 requests per minute.

PDF/Excel export, automatic interest/profit allocation, opening-balance journals and scheduled encrypted backups remain separate work.
