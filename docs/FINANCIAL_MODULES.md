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
| Expense | Expense category, payee, amount, date/reference/note, approval, history, reversal and net cost for the selected period. |
| Bank | Cash/bank account setup, approved transfers, and date-filtered opening/deposit/withdrawal/closing summaries per account. |
| Approval | Maker submits → distinct Approver decides → final approval posts balanced ledger lines. Existing configurable one/two-approver policy and immutable policy snapshots apply to every transaction type. |

## Entering transactions

Admin first adds cash/bank accounts from **Finance → Cash & bank accounts**. Set up an Approver under **Team & access**. Accounts begin at zero; record real deposits before disbursing loans, investing, paying expenses or transferring funds. The default policy prevents the maker from approving their own request.

Use the **Loans**, **Investments**, **Expenses**, **Bank** and **Approvals** sidebar screens. **New transaction** also exposes every supported entry type. New loan/investment records are created only after final approval. Their pending requests remain in Finance history/Approvals. Use **Repay**, **Record return** or **View history** on the corresponding list row. Approval detail shows captured loan terms, investment return split and expense details before a decision is made.

Member savings are separate from loan principal: borrowing and repaying a loan does not alter the member's savings liability. Member logins see their own savings statement and **My loans** under **My dashboard**. Staff can also open loans under a member profile. Bank summaries include all posted cash movements, not only member deposits/withdrawals.

## Explicit calculation rules

- Loans currently use **principal-only monthly installments**. No interest, penalty or service charge is invented. Enter the agreed principal, number of installments (1–600) and first due date. Month-end dates clamp to the last day of shorter months; the next month returns to the original day. Exact division uses cents, with the remainder in the final installment. A schedule cannot contain zero-value installments.
- Approved repayments allocate to the earliest unpaid installment. Outstanding principal derives from the loan receivable ledger, including approved repayment reversals. Payment cannot exceed the loan's outstanding principal at the effective date or cause a later negative principal balance. Other loans' balances cannot be used to repay this loan.
- Investment return **amount = principal returned + profit received**. Both parts are nonnegative decimal strings. Profit-only receipts are supported; principal cannot be returned more than once. Reports show realized profit, not estimated returns. Automatic profit distribution to members and loss/write-off posting are not included.
- Expenses debit the expense account and credit the selected cash/bank account. Reversals reduce net expense. Transfers debit the destination cash/bank account and credit the source; they do not create income or member savings.
- All cash/bank, loan and investment principal balances are checked inside the existing serialized society transaction. Duplicate submissions and concurrent approvals cannot double-post. Insufficient funds roll back the final decision and all related product/ledger writes.
- Corrections require approved reversals. A loan disbursement or investment purchase cannot be reversed while its principal is partially repaid/returned; reverse the dependent transactions first. Product rows remain in history with CANCELLED status after a successful original reversal. A reversal cannot itself be reversed.

## Accounting and API

New account kinds are LOAN_RECEIVABLE (asset), INVESTMENT_ASSET (asset), INVESTMENT_INCOME (income), and EXPENSE. The system reserves their `SYS-*` account codes. Loans and investments use composite society foreign keys. Generic transaction/entry member IDs are nullable for society expenses, investments and transfers; member ownership remains mandatory for savings and loan actions in validation/posting. Product terms are captured with the immutable proposed transaction payload.

All operations reuse `POST /api/finance/transactions`, `Idempotency-Key`, decision, cancellation and reversal routes. Additional entry fields:

| Type | Additional required input |
| --- | --- |
| LOAN_DISBURSEMENT | memberId, installmentCount, firstDueDate |
| LOAN_REPAYMENT | loanId (member is resolved from the loan) |
| INVESTMENT_PURCHASE | title, counterparty |
| INVESTMENT_RETURN | investmentId, principalReturned, profit |
| EXPENSE | category, payee |
| TRANSFER | destinationAccountId (different active account in the same society) |

All entries require cashAccountId, amount and effectiveDate; reference/note are optional. Staff reports require `finance.read`: `GET /finance/loans`, `/finance/loans/:id`, `/finance/investments`, `/finance/investments/:id`, `/finance/bank-summary`. List routes use page/pageSize; loans can filter memberId. Bank summary accepts from/to. Members use `/finance/loans/me` and `/finance/loans/me/:id`, scoped to their linked member irrespective of supplied query filters. All routes require authentication and an active `X-Society-Id`.

Admin/Super Admin manage accounts/policy and may submit/decide requests; Accountant submits; Approver decides; Member only reads their own account. Decisions must also satisfy the policy's maker separation and distinct approver rules.

## Upgrade and verification

Migration `202611110001_financial_products` adds loans/investments, transaction metadata/links and account/transaction enum values, and makes member references nullable for society transactions. Existing deposits, withdrawals, decisions and ledger rows remain intact. Back up SQL and uploads before `npm run db:generate` and `npm run db:migrate`. This workspace's pre-upgrade backup is `backups/somity-before-financial-products-2026-11-11/`.

Unit tests verify month-end scheduling and exact installment sums. MySQL tests exercise principal/profit posting, concurrent repayment limits, insufficient funds, reversals, member/tenant isolation, net expenses and bank reconciliation. Browser tests cover entry → independent approver → reports, private member loan views and mobile layout, plus previous member/society workflows. Browser fixtures only use `somity_test`, and are removed afterward. The general API test budget is higher only for NODE_ENV=test; development/production retain 300 requests per minute.

PDF/Excel export, automatic interest/profit allocation, opening-balance journals and scheduled encrypted backups remain separate work.
