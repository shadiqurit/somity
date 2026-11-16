# Somity agent handoff

## Checkout and status

As of 17 November 2026, the checkout starts from `0e76ce0` on `main`. It includes a profile workflow for recording savings refunds, collecting loan principal and closing the membership. The changes in this checkout add confirmation before opening a settlement and allow staff to cancel it before closure.

Start with [README.md](../README.md) for setup and [API.md](API.md) for route contracts. [SPEC.md](../SPEC.md) is the original project brief. [MULTI_SOCIETY.md](MULTI_SOCIETY.md), [PHASE2.md](PHASE2.md), and [FINANCIAL_MODULES.md](FINANCIAL_MODULES.md) explain the implemented tenancy and accounting workflows. Use the routes, validators, Prisma schema, migrations, and tests to confirm actual behavior when changing a feature.

## Current application

| Area | Implemented behavior |
| --- | --- |
| Platform | Super Admin creates or disables societies, provisions cross-society Admins, lists global user identities, and resets account passwords. Society creation also provisions its first Society Admin. Password reset revokes all sessions for that identity and requires a password change at the next sign-in. |
| Society workspace | The sidebar selection scopes the dashboard, directory, staff, activity, and finance. Super Admin and Admin can select any active society. Society staff and members need an active membership in the selected society. |
| Members | Searchable directory, modal create/edit, optional identity details, nominees with exact 100% allocation, private photos and member login provisioning. Closing or archiving requires zero posted savings and outstanding loan principal and no pending member transactions. Financial history is retained. Member access is read-only for their own profile, approved savings statement, and loans. |
| Finance | Savings deposits/withdrawals, cash/bank account setup, loan disbursements and repayments, investments and returns, other income, expenses, internal transfers, approval queue, reversals, posted ledger, member statements, and reports by product. |
| Activity | Society, personal, and platform feeds expose event metadata with cursor pagination. The separate financial transaction log includes the history of rejected requests removed from the normal transaction list. |

## Latest changes to pick up

- Member profiles now include a final settlement. Migration `202611170005_member_settlement` captures opening dues and links payments to their settlement. [finance.settlement.ts](../backend/src/modules/finance/finance.settlement.ts) calculates the snapshot and payment totals. [MemberSettlement.vue](../frontend/src/modules/members/MemberSettlement.vue) handles the profile workflow. See [the settlement guide](FINANCIAL_MODULES.md#member-final-settlement).
- The final settlement also links to a date-filtered, paginated dues statement. [finance.member-statement.ts](../backend/src/modules/finance/finance.member-statement.ts) reconciles posted savings and loan movements with cash or bank payments. [MemberDuesStatement.vue](../frontend/src/modules/members/MemberDuesStatement.vue) shows running balances and reversal links in English and Bangla.
- Migration `202611170006_member_settlement_cancellation` retains earlier settlement attempts and allows one current settlement per member. Cancelling under the society lock cancels only that settlement’s pending requests, preserves posted payments, and restores regular member transactions. The UI sends the settlement ID with payment, close, and cancel actions to protect against stale dialogs.
- `b722f0a` added four aggregate cards to the Bank page. `GET /api/finance/bank-summary?from=YYYY-MM-DD&to=YYYY-MM-DD` returns `items`, `expenses`, and `summary: { opening, incoming, outgoing, closing }`. Dates are optional and inclusive for within-period movements. The per-account rows include posted transfers and transfer reversals. Aggregate incoming/outgoing omit both sides of internal transfers and their reversals. Net expenses remain available in `expenses`. Amounts are decimal strings.
- The bank report starts in [finance.reports.ts](../backend/src/modules/finance/finance.reports.ts) and renders in [ProductReports.vue](../frontend/src/modules/finance/ProductReports.vue). [types.ts](../frontend/src/modules/finance/types.ts) defines the frontend shape. The finance integration spec checks transfer and reversal reconciliation. The browser finance spec covers the Bank cards and table.
- `cb55af4` added the loan, investment and expense summary endpoints used by the corresponding Finance views. These report posted amounts and their reversals. Pending counts are separate where exposed.
- `bb7e49c` added member and nominee identity details, permanent member closure, rejected-request deletion with retained financial history, and activity feeds. Its four migrations are `202611170001_member_identity_details`, `202611170002_member_closure`, `202611170003_transaction_history`, and `202611170004_activity_log`. The two later reporting commits have no migrations.

## Code map

| Change | Entry points |
| --- | --- |
| Server startup and API wiring | [server.ts](../backend/src/server.ts), [app.ts](../backend/src/app.ts), [env.ts](../backend/src/config/env.ts), [database.ts](../backend/src/config/database.ts) |
| Tenant selection and permissions | [auth middleware](../backend/src/middleware/auth.ts), [auth service](../backend/src/modules/auth/auth.service.ts), [permission definitions](../backend/src/config/permissions.ts), [tenant service](../backend/src/services/tenant.ts), [Pinia auth store](../frontend/src/stores/auth.ts), [Axios client](../frontend/src/services/api.ts) |
| Routes and page layout | [Vue Router](../frontend/src/router/index.ts), [AppLayout.vue](../frontend/src/layouts/AppLayout.vue), [DashboardView.vue](../frontend/src/views/DashboardView.vue) |
| Member records and files | [member service](../backend/src/modules/members/member.service.ts), [member validator](../backend/src/modules/members/member.validator.ts), [upload service](../backend/src/modules/uploads/upload.service.ts), [file cleanup](../backend/src/services/file-cleanup.ts), [member editor](../frontend/src/modules/members/MemberEditor.vue), [member profile](../frontend/src/modules/members/MemberProfile.vue) |
| Finance validation, writes and reads | [finance routes](../backend/src/modules/finance/finance.routes.ts), [validator](../backend/src/modules/finance/finance.validator.ts), [service](../backend/src/modules/finance/finance.service.ts), [posting rules](../backend/src/modules/finance/finance.posting.ts), [reports](../backend/src/modules/finance/finance.reports.ts), [FinanceView.vue](../frontend/src/modules/finance/FinanceView.vue), [MemberStatement.vue](../frontend/src/modules/finance/MemberStatement.vue) |
| Activity and transaction history | [audit helper](../backend/src/services/audit.ts), [activity routes](../backend/src/modules/activity/activity.routes.ts), [activity service](../backend/src/modules/activity/activity.service.ts), [ActivityView.vue](../frontend/src/views/ActivityView.vue), [TransactionLog.vue](../frontend/src/modules/finance/TransactionLog.vue) |
| Data and provisioning | [Prisma schema](../backend/prisma/schema.prisma), [migrations](../backend/prisma/migrations/), [seed](../backend/prisma/seed.ts), [Prisma CLI config](../backend/prisma7.config.ts) |

The frontend uses Vue 3, Vue Router, Pinia, Axios, Vite and TypeScript. Reuse the shared inputs, modal, table and summary-card components under `frontend/src/components/`. API modules use Express 5, Zod validators and Prisma 7.10.1 with the MariaDB adapter against MySQL 8. Prisma CLI, client and adapter versions are pinned together.

## Behavior to preserve

- Treat `X-Society-Id` as a selection. Resolve the session, role and permissions on the server and scope the query to the validated society, including for platform users. Composite foreign keys enforce tenant consistency. Missing business scope returns 400, unauthorized scope returns 403, and an out-of-society record returns 404 after valid scope selection.
- `ADMIN` is a platform finance role with member and dashboard reads. `SOCIETY_ADMIN` also manages member records and staff in its assigned society. Accountant submits requests, Approver decides, and both can read staff finance. Member routes derive ownership from the authenticated identity.
- The browser keeps its 15-minute access JWT in memory and restores the session with a rotating HttpOnly refresh cookie. Auth POST requests must send the configured frontend Origin. Axios attaches the society header and preserves the original selection when retrying a request. Switching society reloads the workspace.
- Finance posting supports BDT. Amounts use exact decimal strings and ledger arithmetic uses `Prisma.Decimal`. Use `YYYY-MM-DD` effective dates and the Asia/Dhaka business-date rules. Pending, rejected and cancelled requests have no posted balance effect. Financial writes and member termination use the same society lock. Final approval commits the decision, balanced ledger lines, and audit together. Account, savings and product principal checks also protect historical balances for backdated entries.
- Submission and reversal require a society-scoped `Idempotency-Key`. The request captures approval policy at submission. The default requires a distinct approver. Posted corrections go through approved reversals. Rejected-request deletion sets `deletedAt` and retains the original request and audit trail.
- Member edits, photos and other mutations must respect optimistic versions. Photo upload validates and re-encodes bytes and replaces metadata transactionally. Superseded bytes are removed after commit, with durable cleanup retries. Keep credentials and private upload paths out of public responses and audit payloads.

## Local setup and verification

From the root, use Node 22.12+ and npm with an existing MySQL 8.0.16+ server. Set up `backend/.env` using [backend/.env.example](../backend/.env.example). Keep signing secrets, credentials and private data local.

```powershell
npm ci
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

The Vite app is at `http://localhost:5173` and proxies `/api` to `127.0.0.1:4000` by default. `GET /api/health` checks database connectivity. The seed initializes permissions and the first Super Admin on a fresh installation. Rerunning it preserves an existing user's password and current platform-role assignment. The old `scripts/prepare-local.mjs` is for a retired isolated MySQL setup and rewrites `backend/.env`. Use the README workflow for the current installation.

| Check | Result during this handoff |
| --- | --- |
| `npm run typecheck` | Passed for both workspaces. |
| Prisma client generation and workspace builds | Passed for backend and frontend. |
| `npm run build:lan -w frontend` | Passed for the `/somity/` target. |
| `npm test` | Passed, 8 backend unit tests. |
| MySQL integration suites | Applied `202611170006_member_settlement_cancellation` to the isolated test schema and passed all 48 tests. |
| `npm run test:e2e` | Passed all three browser workflows, including going back before confirmation, cancelling and restarting a settlement, and confirming closure. |

For database checks, use the isolated `TEST_DATABASE_URL` schema ending in `_test` and apply all committed migrations to it using the [README procedure](../README.md#verification). The integration command runs the member/auth/photo, tenancy and finance suites under [backend/tests](../backend/tests/). Playwright uses Chrome by default and starts a dedicated API on port 4100 and frontend on port 5174. Its fixtures and storage setup are documented in [the browser test README](../tests/e2e/README.md).

## Deployment and pending decisions

- The repository has Nginx configurations for the root HTTPS VPS build and the LAN `/somity/` build. The Nginx setup proxies to the local PM2 backend on port 3004. LAN routing uses a Vite base of `/somity/`, SPA fallback, and a rewrite for the refresh cookie path. The cancellation migration was applied to the test schema. Apply it to the target database before deploying the updated API. See the [Windows Nginx guide](WINDOWS_NGINX_DEPLOYMENT.md) or the [Caddy/WinSW guide](WINDOWS_DEPLOYMENT.md) as appropriate.
- Back up SQL and private uploads before an upgrade. Generate the client, review and deploy committed migrations, rebuild, restart the API, and verify health plus a signed-in page reload. The health response checks database reachability and advertises capabilities. It does not establish that a specific report or migration works.
- The guides identify later work including opening-balance journals, PDF/Excel exports, automatic interest/profit allocation, scheduled encrypted backups, and linking an existing login to another society through the UI. These have no assigned priority here.
