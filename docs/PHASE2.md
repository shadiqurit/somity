# Phase 2: member savings and approvals

This increment implements member deposits and withdrawals, cash/bank accounts, one- or two-person approval, double-entry posting, reversals, society ledger and member statements. It builds on the existing society boundary and uses the configured MySQL server. It does not provision another MySQL instance or recreate `.local`.

## Workflow

1. Admin opens **Finance → Cash & bank accounts → Add account** and creates the actual cash/bank accounts used by the society. Accounts start at zero. Bank metadata stores the bank name and optional last four digits only.
2. Accountant or Admin opens **New transaction**, selects an active member and cash/bank account, and submits a deposit or withdrawal. A receipt/reference and note can be included. Amounts are BDT decimal strings with at most two decimal places. Future effective dates are rejected.
3. Admin or Approver opens **Review** and approves or rejects. Default policy requires one approval and forbids deciding one's own request. Admin can select two distinct approvers and optionally permit self-approval. Each request captures its policy version and rules; changing the policy does not change pending requests. Set up another authorized approver before using the default policy with Admin-created requests.
4. Only final approval posts balanced ledger entries and changes balances. Rejection requires a reason. A requester can cancel a pending request. Failed posting rolls back its final approval too, allowing the request to be reviewed again after resolving the problem.
5. Open the society ledger for posted debit/credit lines. Member profiles contain a date-filtered statement with opening/closing balances and running balances. Members see only their own statement through **My dashboard**.
6. To correct an approved transaction, request a full reversal with a reason, approve it, then submit a replacement if required. The original entry remains unchanged. Reversals cannot themselves be reversed; simultaneous or duplicate active reversals are rejected. A rejected/cancelled reversal can be requested again.

## Tables and accounting

| Table | Purpose |
| --- | --- |
| accounts | Society-scoped cash/bank assets and the system MEMBER-SAVINGS liability account. Unique society/code. |
| transactions | Immutable proposed amounts, member/account, effective date, request hash/idempotency key, captured policy and reversal link; lifecycle PENDING/POSTED/REJECTED/CANCELLED. |
| transaction_entries | Exact DECIMAL(20,2) debit/credit lines; each line has exactly one positive side, enforced by MySQL CHECK. |
| approval_policies | Current society-wide policy with optimistic version. Applies to all supported transaction types. |
| approval_steps | Ordered decisions, unique approver and step per request. |

A deposit debits cash/bank and credits member savings. A withdrawal debits member savings and credits cash/bank. A reversal posts equal/opposite entries. Statements and summaries derive from posted ledger lines; there are no floating-point or manually editable balance fields. "Savings in/out" includes the corresponding reversal movements so opening + in − out = closing.

Financial writes lock their active society row inside a READ COMMITTED transaction. This serializes requests/approvals within a society and prevents concurrent overspending or duplicate posting. Both the member's savings and selected cash/bank funds must remain nonnegative at the effective date and subsequent daily balances, including for backdated requests and deposit reversals. This deliberate locking approach suits the current modular monolith; per-account locks can replace it when measured throughput requires more concurrency.

Composite foreign keys scope every business relation to its society. Decisions, postings, reversals and policy/account creation are audited atomically. Public financial APIs do not update/delete posted headers or ledger lines. Application authorization enforces this immutability; an unrestricted database administrator can still alter the database directly.

## Permissions

| Role | Read ledger/accounts/statements | Submit/cancel own/request reversal | Approve/reject | Accounts/policy |
| --- | --- | --- | --- | --- |
| Super Admin / Admin | Yes | Yes | Yes | Yes |
| Accountant | Yes | Yes | No | No |
| Approver | Yes | No | Yes | No |
| Member | Own approved statement only | No | No | No |

## Installation and upgrade

Back up SQL and private uploads, generate the client, and apply committed migrations:

```powershell
npm run db:generate
npm run db:migrate
npm run build
npm run dev
```

Migration `202611100001_member_finance` only adds the financial tables, checks and permission grants. Existing users/passwords, societies, members and photos remain intact. It grants financial permissions to existing roles, so a seed rerun is not required. New societies start with the default approval policy and no cash/bank accounts.

The pre-upgrade SQL and uploaded-file backup for this workspace is in `backups/somity-before-phase2-2026-11-10/`. A separate `somity_test` schema on the same configured MySQL server is used for migration rehearsal and fixtures. Integration/browser fixtures are uniquely named and cleaned up; no sample financial transactions are inserted into the application's `somity` schema. Test uploads use `test-results/`, not `.local`.

## Verification and scope

Unit tests cover decimal validation and exact balanced lines. MySQL tests cover permissions, tenant foreign keys, pending/rejected/cancelled effects, idempotency, concurrent approvals and withdrawals, policy snapshots, distinct approvers, self-approval, date/fund checks, reversal preservation, member ownership and statement pagination/totals. Browser tests exercise account creation, request submission, approval, ledger and a private member statement on mobile, alongside the existing Phase 1 workflows.

Loans, investments, profit distribution, income/expenses, bank-to-bank transfers, opening-balance journals, PDF/Excel export, and scheduled/encrypted backup UI remain later increments. This release manages BDT member savings and does not expose unfinished features or fabricated balances.
