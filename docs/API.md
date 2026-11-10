# Phase 1 REST API

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

Accountant and Approver acquire financial permissions only when those modules are implemented. No public registration or browser-selected role assignment exists. Superadmin manages societies and creates each society’s first Admin. Tenant Admin and Superadmin can create staff and member logins within the selected society; only the seed creates the initial platform Superadmin. New accounts must change temporary passwords before accessing business data.

## Multiple-society contract

See [MULTI_SOCIETY.md](MULTI_SOCIETY.md) for schema constraints, migration, role resolution and isolation guarantees. Society creation fields are name (2–120 characters), code (2–40 letters/numbers/hyphens, normalized uppercase), optional contact email/phone/address, and required admin name/email/password. Update uses those contact fields plus version and isActive, and never changes existing credentials. Login emails are globally unique; member contact emails and numbers are unique per society. Missing business context returns 400, forged membership selection 403, and another society’s record 404 after scope validation. Only platform Super Admin may access /societies, regardless of any tenant role permissions.
