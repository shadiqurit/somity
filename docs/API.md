# Phase 1 and Phase 2 REST API

## Phase 2 finance endpoints

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
| POST `/finance/transactions/:id/decision` | finance.approve | decision APPROVE/REJECT, optional comment (reason of at least 5 characters required for REJECT). Final approval posts atomically. |
| POST `/finance/transactions/:id/cancel` | finance.write | Requester cancels a pending request. No posted data is deleted. |
| POST `/finance/transactions/:id/reversal` | finance.write | effectiveDate and reason in note (5–500 characters); requires a fresh `Idempotency-Key`. Requests full opposite posting after approval. |
| GET `/finance/ledger` | finance.read | Paginated posted debit/credit lines; optional memberId/from/to. |
| GET `/finance/summary` | finance.read | Savings in/out for optional from/to, approved savings through to, and count of all pending requests. |
| GET `/finance/statements/:memberId` | finance.read | Approved movements, opening/closing/running balances; optional from/to/page/pageSize. Archived members' financial history remains available to staff. |
| GET `/finance/statements/me` | profile.read | Identical statement restricted to the caller's linked member. Cannot select another member. |

Submission keys are unique per society. Replaying the same normalized payload and requester returns its original transaction, including its current state; reusing a key for a different payload returns 409. Decision retries after completion return 409 without reposting. Insufficient member/cash funds return 409 and roll back the failed final decision. Another society's record/account returns 404, unauthorized operations 403, and malformed fields 422. There are no update/delete APIs for posted transactions or entries. The default policy requires a distinct authorized approver; Admin/Approver/Super Admin can decide, Accountant can submit, and only Admin/Super Admin manage accounts/policy.

## Phase 1 endpoints

Base path `/api`. Business endpoints require `X-Society-Id` for an active society the caller can access. `/auth/*` and the platform `/societies` routes do not require this header, although `/auth/me` and refresh use it to resolve the selected society. Roles/permissions and member ownership are resolved within that society on every request. Responses are JSON except authenticated document downloads. Authentication uses a 15-minute Bearer JWT kept in browser memory and a rotating 7-day opaque refresh token in a HttpOnly, SameSite=Strict cookie scoped to `/api/auth`. Production cookies require HTTPS. Auth POSTs require an `Origin` exactly matching `FRONTEND_ORIGIN`, including command-line clients. Cross-origin frontend deployments must be same-site for the strict refresh cookie; prefer a same-origin `/api` reverse proxy.

Errors use `{ "error": { "message": "...", "fields": { "field": ["reason"] } } }`; fields are present for validation failures. Statuses: 400 malformed JSON/current password, 401 missing/expired credentials, 403 permission/origin/temporary password, 404 absent record, 409 duplicate/stale write, 413 oversized JSON, 422 invalid input/upload, 429 throttled, 500 unexpected error. Sensitive internals are not returned.

| Method and path | Access | Request/result |
| --- | --- | --- |
| GET /health | Public | Checks MySQL; returns status, version and photo-removal/cleanup capability flags to identify a stale API deployment. |
| POST /auth/login | Public + trusted Origin | `{email,password}` → `{accessToken,user}` + refresh cookie. 10 failed attempts per IP / 15 min. |
| POST /auth/refresh | Refresh cookie + Origin | Rotates cookie and returns new access token/user. Reuse revokes the token family. |
| POST /auth/logout | Origin | Revokes cookie's family and clears cookie; 204. |
| GET /auth/me | Authenticated | Current user, roles, permissions, memberId and mustChangePassword. |
| POST /auth/password | Authenticated + Origin | `{currentPassword,newPassword}`; invalidates all sessions, clears cookie, 204. |
| GET /dashboard | dashboard.read | Actual member counts and 5 recently added members. No fabricated financial balances. |
| GET /roles | users.manage | Available tenant role code/name pairs; platform SUPER_ADMIN is excluded. |
| GET /societies?page=1&search=... | Platform Super Admin | Paginated society details, active status and member/user counts. |
| POST /societies | Platform Super Admin | Society details plus `{admin:{name,email,password}}`; atomically creates the society and its first Admin; 201. |
| PUT /societies/:id | Platform Super Admin | Society details plus `{version,isActive}`; optimistic update; 200. |
| GET /users?page=1 | users.manage | Paginated identities, role names and status; 20 rows/page, no password hashes. |
| POST /users | users.manage | `{name,email,password,roleCode}`; creates staff, 201. roleCode: ADMIN, ACCOUNTANT or APPROVER. Creates a membership in the selected society only. |
| GET /members | members.read | Searchable/paginated non-archived members. |
| POST /members | members.write | Member input below → persisted member, 201. |
| GET /members/me | profile.read | Own linked profile. No arbitrary member ID. |
| GET /members/:id | members.read OR own profile.read | Full profile, nominees, latest photo metadata and safe login metadata. |
| PUT /members/:id | members.write | Full member input + current numeric `version`; atomic nominee replacement. Returns updated member. |
| DELETE /members/:id | members.archive | `{version}`; soft archive + login/session disable, 204. |
| POST /members/:id/login | users.manage | `{email,password}`; member-only role, forced initial password change, 201. |
| POST /members/:id/photo | members.write | multipart field `photo`, max 5 MB, JPG/PNG; decodes and reencodes JPEG, strips metadata, max 20 MP; replaces old photo metadata and files; 201 `{id}`. |
| DELETE /members/:id/photo | members.write | `{documentId}` for the currently displayed photo; removes photo metadata and files, audits removal, 204. Stale photo IDs return 409 when a newer photo exists. |
| GET /documents/:id | members.read OR owning profile.read | Authenticated photo bytes; no public storage URL. |

All protected business endpoints require initial password change to be complete. API-wide limiter: 300 requests per IP / minute. The initial single-process store should be replaced with a shared store for multiple replicas. Staff create/update/delete and photo operations write audit events within the same DB transaction. Refresh tokens and password hashes are never included in API responses or audit snapshots.

Photo changes serialize on the member row and increment its version. A failed image validation leaves the current photo intact. Replacement commits the new photo, old metadata deletion, audit event and file-cleanup jobs together; old bytes are deleted only after commit. Removal is harmless to retry when no photo remains and never deletes other document kinds. Physical deletion is attempted before returning; failures remain queued in `file_deletions` and retry at API startup and every minute. The cleanup migration also queues legacy superseded photos while retaining the latest one per member. In the edit modal, removal waits for Save; Cancel and Keep current photo preserve the existing image.

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

Email may be omitted, empty or null. Status is ACTIVE, INACTIVE or SUSPENDED. Phone accepts `+`, digits, spaces, parentheses and hyphens. Nominee shares are decimal strings, each positive and ≤100 with at most two decimal places; the total must be exactly 100%. 1–10 nominees are required. PUT uses all input fields plus `version`. The server generates memberNo; clients cannot change identity, login link, photo metadata or archive timestamp through this form. Names, contact details and addresses accept Bangla and English Unicode.

List query: `page=1&pageSize=10&search=...&status=ACTIVE&sort=createdAt&direction=desc`. pageSize: 1–100; sort: createdAt, fullName, memberNo; direction asc/desc. Result: `{items,total,page,pageSize,pages}`. An empty result has pages=0. Sorts include an ID tiebreaker. Unique email/member number conflicts return 409. Current member `version` changes on edits, photo upload, login provisioning and archival; refetch before editing after any of these operations.

## Permission matrix

| Role | Dashboard | All profiles | Edit/create | Archive | Staff/member logins | Own profile |
| --- | --- | --- | --- | --- | --- | --- |
| Super Admin | Yes | Yes | Yes | Yes | Yes | If linked |
| Admin | Yes | Yes | Yes | Yes | Yes | No |
| Accountant | Yes | Yes | No | No | No | No |
| Approver | Yes | Yes | No | No | No | No |
| Member | No | No | No | No | No | Yes |

Accountant can read finance and submit requests. Approver can read finance and approve/reject requests. Admin and Super Admin also manage accounts and approval policy. Members can read only their own statement. No public registration or browser-selected role assignment exists. Superadmin manages societies and creates each society’s first Admin. Tenant Admin and Superadmin can create staff and member logins within the selected society; only the seed creates the initial platform Superadmin. New accounts must change temporary passwords before accessing business data.

## Multiple-society contract

See [MULTI_SOCIETY.md](MULTI_SOCIETY.md) for schema constraints, migration, role resolution and isolation guarantees. Society creation fields are name (2–120 characters), code (2–40 letters/numbers/hyphens, normalized uppercase), optional contact email/phone/address, and required admin name/email/password. Update uses those contact fields plus version and isActive, and never changes existing credentials. Login emails are globally unique; member contact emails and numbers are unique per society. Missing business context returns 400, forged membership selection 403, and another society’s record 404 after scope validation. Only platform Super Admin may access /societies, regardless of any tenant role permissions.
