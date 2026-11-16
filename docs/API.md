# Phase 1 and Phase 2 REST API

## Activity log

`GET /api/activity` requires `activity.read` and a selected society. `GET /api/activity/me` returns events performed by the signed-in account in the selected society or at platform scope. `GET /api/activity/platform` gives Super Admin access across societies. Each feed accepts `action`, `actorRole`, `limit` (max 100), and `after` (the previous response’s `nextCursor`).

Events show the action, actor, recorded role, target, society and time. Older audit records can have an unrecorded role. The activity endpoints return event metadata without the stored audit payload. `POST /api/auth/select-society` validates the `X-Society-Id` selection and records it as an activity event.

## Phase 2 finance endpoints

Loan/investment/expense/transfer entry types and report routes are documented in [FINANCIAL_MODULES.md](FINANCIAL_MODULES.md). Society transactions can have `member: null`; clients must handle this when displaying finance history and ledger lines.

All routes below require authentication, a changed initial password and an active `X-Society-Id`. See [PHASE2.md](PHASE2.md) for accounting and approval rules. Financial amounts must be decimal **strings** (for example `"1250.50"`), not JSON numbers. Dates use `YYYY-MM-DD`.

| Method/path under `/api` | Permission | Purpose |
| --- | --- | --- |
| GET `/finance/accounts` | finance.read | Account metadata and posted balances. |
| POST `/finance/accounts` | finance.settings | Create CASH/BANK account: code, name, kind, optional bankName/last four digits; bankName required for BANK. Starts at zero. |
| GET `/finance/policy` | finance.read | Current policy; version 0 represents the default before first save. |
| PUT `/finance/policy` | finance.settings | version, requiredApprovals (1/2), allowSelfApproval; stale versions return 409. |
| GET `/finance/transactions` | finance.read | Paginated requests/history; page/pageSize (max 100), optional status/type/memberId/from/to. |
| POST `/finance/transactions` | finance.write | Submit DEPOSIT/WITHDRAWAL: type, memberId, cashAccountId, amount, effectiveDate, optional reference/note. Requires `Idempotency-Key` header (16–80 letters/numbers/hyphens/underscores). |
| GET `/finance/transactions/:id` | finance.read | Request, captured policy, decision history, original/reversal links and posted entries. |
| DELETE `/finance/transactions/:id` | finance.delete | Removes a rejected request from the transaction list. Retains its record, decisions, and audit history. Returns 204. Available to Society Admin, Admin, and Super Admin within the selected society. |
| GET `/finance/transaction-log` | finance.read | Newest-first audit events, including deleted requests. Accepts `transactionNo`, `action`, `limit` (max 100), and `after` (the previous response’s `nextCursor`). |
| POST `/finance/transactions/:id/decision` | finance.approve | decision APPROVE/REJECT, optional comment (reason of at least 5 characters required for REJECT). Final approval posts atomically. |
| POST `/finance/transactions/:id/cancel` | finance.write | Requester cancels a pending request. No posted data is deleted. |
| POST `/finance/transactions/:id/reversal` | finance.write | effectiveDate and reason in note (5–500 characters); requires a fresh `Idempotency-Key`. Requests full opposite posting after approval. |
| GET `/finance/ledger` | finance.read | Paginated posted debit/credit lines; optional memberId/from/to. |
| GET `/finance/summary` | finance.read | Savings in/out for optional from/to, approved savings through to, and count of all pending requests. |
| GET `/finance/loan-summary` | finance.read | Society-wide loan principal disbursed, repaid, and outstanding after posted reversals, plus the number of pending loan requests. |
| GET `/finance/investment-summary` | finance.read | Society-wide principal invested, returned, and outstanding, plus realized profit after posted reversals. |
| GET `/finance/expense-summary` | finance.read | Approved expenses, expense reversals, net expenses, and pending expense requests. Optional `from` and `to` filter by effective date. |
| GET `/finance/bank-summary` | finance.read | Returns `{items, expenses, summary: {opening, incoming, outgoing, closing}}` for cash and bank accounts. Per-account flows include internal transfers and their reversals. Combined flows omit both. Accepts optional `from` and `to`. |
| GET `/finance/income-summary` | finance.read | Approved other income, investment profit and reversals. Accepts optional `from` and `to`. |
| GET `/finance/statements/:memberId` | finance.read | Approved movements, opening/closing/running balances; optional from/to/page/pageSize. Archived members' financial history remains available to staff. |
| GET `/finance/statements/me` | profile.read | Identical statement restricted to the caller's linked member. Cannot select another member. |

Submission keys are unique per society. Replaying the same normalized payload and requester returns its original transaction, including its current state; reusing a key for a different payload returns 409. Decision retries after completion return 409 without reposting. Insufficient member/cash funds return 409 and roll back the failed final decision. Another society's record/account returns 404, unauthorized operations 403, and malformed fields 422. There are no update/delete APIs for posted transactions or entries. The default policy requires a distinct authorized approver. Super Admin, Admin and Society Admin can submit transactions, decide requests and manage accounts and approval policy within their authorized society scope. Accountant can submit requests and Approver can decide them.

## Phase 1 endpoints

Base path `/api`. Society business endpoints and `POST /auth/select-society` require `X-Society-Id` for an active society the caller can access. Other auth routes, platform routes and personal activity can be called without the header. Auth resolves the selected society when the header is supplied. Roles, permissions and member ownership are resolved on every request. Responses are JSON except authenticated document downloads. Authentication uses a 15-minute Bearer JWT kept in browser memory and a rotating 7-day opaque refresh token in a HttpOnly, SameSite=Strict cookie scoped to `/api/auth`. The API sets Secure on production cookies. The Windows LAN proxy rewrites the cookie path and Secure flag for its HTTP deployment as described in the [LAN guide](WINDOWS_NGINX_DEPLOYMENT.md#windows-lan-at-192168559somity). Auth POSTs require an `Origin` exactly matching `FRONTEND_ORIGIN`, including command-line clients. Cross-origin frontend deployments must be same-site for the strict refresh cookie.

Errors use `{ "error": { "message": "...", "fields": { "field": ["reason"] } } }`; fields are present for validation failures. Statuses: 400 malformed JSON/current password, 401 missing/expired credentials, 403 permission/origin/temporary password, 404 absent record, 409 duplicate/stale write, 413 oversized JSON, 422 invalid input/upload, 429 throttled, 500 unexpected error. Sensitive internals are not returned.

| Method and path | Access | Request/result |
| --- | --- | --- |
| GET /health | Public | Checks MySQL; returns status, version and photo-removal/cleanup capability flags to identify a stale API deployment. |
| POST /auth/login | Public + trusted Origin | `{email,password}` → `{accessToken,user}` + refresh cookie. 10 failed attempts per IP / 15 min. |
| POST /auth/refresh | Refresh cookie + Origin | Rotates cookie and returns new access token/user. Reuse revokes the token family. |
| POST /auth/logout | Origin | Revokes cookie's family and clears cookie; 204. |
| GET /auth/me | Authenticated | Current user, roles, permissions, memberId and mustChangePassword. |
| POST /auth/select-society | Authenticated + trusted Origin + active society | Validates the society in `X-Society-Id`, records the selection and returns the scoped user. |
| POST /auth/password | Authenticated + Origin | `{currentPassword,newPassword}`; invalidates all sessions, clears cookie, 204. |
| GET /dashboard | dashboard.read | Member counts and the 5 most recently added members. |
| GET /roles | users.manage | Society role code/name pairs for `SOCIETY_ADMIN`, `ACCOUNTANT`, `APPROVER` and `MEMBER`. |
| GET /societies?page=1&search=... | Platform Super Admin | Paginated society details, active status and member/user counts. |
| POST /societies | Platform Super Admin | Society details plus `{admin:{name,email,password}}`. Creates the society and its first Society Admin atomically, 201. |
| PUT /societies/:id | Platform Super Admin | Society details plus `{version,isActive}`; optimistic update; 200. |
| GET /platform/users?page=1&search=... | Platform Super Admin | Paginated global accounts and role names. |
| POST /platform/users | Platform Super Admin | `{name,email,password}` creates an `ADMIN` with access to every active society, 201. No society selection is required. |
| PUT /platform/users/:id/password | Platform Super Admin | `{password}` sets a new temporary password, revokes the target user's existing sessions and records the reset. Returns 204. |
| GET /users?page=1 | users.manage | Paginated identities, role names and status; 20 rows/page, no password hashes. |
| POST /users | users.manage | `{name,email,password,roleCode}` creates staff, 201. Accepts `SOCIETY_ADMIN`, `ACCOUNTANT` or `APPROVER` and creates a membership in the selected society. |
| GET /members | members.read | Searchable/paginated non-archived members. |
| POST /members | members.write | Member input below → persisted member, 201. |
| GET /members/me | profile.read | Own linked profile. No arbitrary member ID. |
| GET /members/:id | members.read OR own profile.read | Full profile, nominees, latest photo metadata and safe login metadata. |
| PUT /members/:id | members.write | Full member input + current numeric `version`; atomic nominee replacement. Returns updated member. |
| DELETE /members/:id | members.archive | Accepts `{version}`. Closes and soft-archives the member, disables portal access, and returns 204. Requires zero posted savings and loan balances and no pending member transactions. |
| POST /members/:id/login | users.manage | `{email,password}`; member-only role, forced initial password change, 201. |
| POST /members/:id/photo | members.write | multipart field `photo`, max 5 MB, JPG/PNG; decodes and reencodes JPEG, strips metadata, max 20 MP; replaces old photo metadata and files; 201 `{id}`. |
| DELETE /members/:id/photo | members.write | `{documentId}` for the currently displayed photo; removes photo metadata and files, audits removal, 204. Stale photo IDs return 409 when a newer photo exists. |
| GET /documents/:id | members.read OR owning profile.read | Authenticated photo bytes; no public storage URL. |

All protected business endpoints require initial password change to be complete. The API-wide limiter allows 300 requests per IP per minute outside tests. The initial single-process store should be replaced with a shared store for multiple replicas. Staff provisioning and photo mutations write audit events within the same database transaction. Refresh tokens travel in the session cookie. Response bodies and audit snapshots exclude refresh tokens and password hashes.

Photo changes serialize on the member row and increment its version. A failed image validation leaves the current photo intact. Replacement commits the new photo, old metadata deletion, audit event and file-cleanup jobs together; old bytes are deleted only after commit. Removal is harmless to retry when no photo remains and never deletes other document kinds. Physical deletion is attempted before returning; failures remain queued in `file_deletions` and retry at API startup and every minute. The cleanup migration also queues legacy superseded photos while retaining the latest one per member. In the edit modal, removal waits for Save; Cancel and Keep current photo preserve the existing image.

## Member final settlement

These routes are scoped to the active society. A settlement captures posted savings owed to the member and outstanding principal per loan. It retains its original dues and linked payment attempts after closure. All amounts are decimal strings.

| Method and path under `/api` | Permission | Purpose |
| --- | --- | --- |
| GET `/members/:id/settlement` | finance.read | Returns status, opened/closed dates, pending count, per-item due, paid, pending, remaining and available amounts, and linked payment history. Before starting it shows current dues. |
| GET `/members/:id/settlement/statement` | finance.read | Returns opening balances, movements and closing balances for savings and loan principal. Each posted transaction shows who paid, the cash or bank account, any related loan or reversal, and both balances after the transaction. Accepts optional `from`, `to`, `page` and `pageSize` (maximum 100). Newest entries appear first. |
| POST `/members/:id/settlement` | members.archive | Captures the opening dues after confirmation in the UI. Any pending member transaction blocks opening. An already open settlement is returned as-is. |
| POST `/members/:id/settlement/payments` | finance.write | Queues a normal approval request with `cashAccountId`, `amount`, `effectiveDate`, optional `reference` and `note`, and `loanId` for a repayment. Omit `loanId` or send null for a savings refund. Requires `Idempotency-Key`. Supply the current `settlementId` to guard against submitting into a later settlement. |
| POST `/members/:id/settlement/close` | members.archive | Requires zero posted savings and outstanding loan principal and no pending member transactions. Retains the settlement, closes the membership and disables its login. Repeating a completed close returns the same record. An optional `settlementId` guards against closing a later settlement. |
| POST `/members/:id/settlement/cancel` | members.archive | Takes `{settlementId}` for the open settlement. Cancels its pending requests, preserves posted payments and audit history, and restores regular member transactions. An already cancelled settlement can be retried safely. A completed settlement returns 409. |

Settlement payment requests use the existing finance decision, cancellation and reversal routes. Paid amounts are posted payments less posted reversals. Pending originals reserve the amount that can still be submitted. While settlement is open, regular finance submission and historical reversals for that member are blocked to preserve the opening dues. Settlement payments themselves can be reversed before closure.

## Member input

```json
{
  "fullName": "Example Member",
  "phone": "+8801700000000",
  "email": "member@example.com",
  "address": "Dhaka, Bangladesh",
  "joinedAt": "2026-11-09",
  "status": "ACTIVE",
  "nominees": [{
    "fullName": "Example Nominee",
    "relationship": "Spouse",
    "phone": "+8801800000000",
    "address": "Dhaka, Bangladesh",
    "sharePercent": "100.00"
  }]
}
```

Email may be omitted, empty or null. Members accept optional `identityNumber` (40 characters), `nationality` (120), `dateOfBirth` (ISO date) and `permanentAddress` (500). Nominees accept optional `identityNumber` (40). New members can be ACTIVE, INACTIVE or SUSPENDED. PUT also accepts CLOSED for existing members once posted savings and outstanding loan principal both reach zero and all pending member transactions are resolved. Closure is permanent, disables the member portal login, and preserves financial history. GET /members accepts CLOSED as a status filter. Phone accepts `+`, digits, spaces, parentheses and hyphens. Nominee shares are positive decimal strings up to 100, with a maximum of two decimal places and an exact total of 100%. The request requires 1–10 nominees. PUT uses the full member input plus `version`. The server assigns memberNo and manages login links, photo metadata and archive timestamps. Names, contact details and addresses accept Bangla and English Unicode.

List query: `page=1&pageSize=10&search=...&status=ACTIVE&sort=createdAt&direction=desc`. pageSize: 1–100; sort: createdAt, fullName, memberNo; direction asc/desc. Result: `{items,total,page,pageSize,pages}`. An empty result has pages=0. Sorts include an ID tiebreaker. Unique email/member number conflicts return 409. Current member `version` changes on edits, photo upload, login provisioning and archival; refetch before editing after any of these operations.

## Permission matrix

| Role | Dashboard | All profiles | Edit/create | Archive | Staff/member logins | Own profile |
| --- | --- | --- | --- | --- | --- | --- |
| Super Admin | Yes | Yes | Yes | Yes | Yes | If linked |
| Admin | Yes | Yes | No | No | No | No |
| Society Admin | Yes | Yes | Yes | Yes | Yes | No |
| Accountant | Yes | Yes | No | No | No | No |
| Approver | Yes | Yes | No | No | No | No |
| Member | No | No | No | No | No | Yes |

Accountant can read finance and submit requests. Approver can read finance and approve or reject requests. Super Admin, Admin and Society Admin can manage accounts and approval policy. Members can read their own statement and loans. Super Admin manages societies and provisions each society’s first Society Admin. Society Admin and Super Admin can create staff and member logins within the selected society. The seed provisions the initial platform Super Admin. New accounts must change temporary passwords before accessing business data.

## Multiple-society contract

See [MULTI_SOCIETY.md](MULTI_SOCIETY.md) for schema constraints, migration, role resolution and isolation guarantees. Society creation fields are name (2–120 characters), code (2–40 letters/numbers/hyphens, normalized uppercase), optional contact email/phone/address, and required admin name/email/password. Update uses those contact fields plus version and isActive, and never changes existing credentials. Login emails are globally unique; member contact emails and numbers are unique per society. Missing business context returns 400, forged membership selection 403, and another society’s record 404 after scope validation. Only platform Super Admin may access /societies, regardless of any tenant role permissions.
