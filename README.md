# Somity — Society Management, Phase 2

Separate Vue 3 / Vite / TypeScript frontend and Express / TypeScript / MySQL 8 / Prisma backend, following `SPEC.md`. This phase delivers authentication, permissions, an admin dashboard, member CRUD with nominees/private photos, search/pagination, a read-only member dashboard, migrations and superadmin provisioning.

Multiple societies are supported, each with its own Admin, Approver, Accountant and Members. Super Admin manages the platform; the sidebar society selector scopes all business screens and APIs. Existing records migrate into the first society without changing profile URLs. See [the multi-society guide](docs/MULTI_SOCIETY.md) for setup, isolation and migration details.

Phase 2 adds member deposits/withdrawals, cash and bank accounts, one- or two-person approvals, a balanced ledger, approved reversals, and private member statements. See [the Phase 2 guide](docs/PHASE2.md) for workflow, migration, permissions and tested guarantees. Loans with monthly principal installments and repayments, investments with principal/profit returns, society expenses and cash/bank transfers are now implemented; see [the financial modules guide](docs/FINANCIAL_MODULES.md). Automatic interest/profit allocation, PDF/Excel export and automated encrypted backups remain separate work. No financial records or balances are mocked.

## Setup

Requires Node 22.12+ (Node 24 recommended), npm, and MySQL 8.0.16+.

1. Create a MySQL database `somity` using `utf8mb4_unicode_ci`, and a database user authorized for that schema. Use a separate migration user with DDL privileges in production.
2. Copy `backend/.env.example` to `backend/.env`. Set DATABASE_URL, a random JWT_ACCESS_SECRET of at least 32 characters, FRONTEND_ORIGIN, and your chosen SEED_ADMIN_EMAIL / SEED_ADMIN_NAME / SEED_ADMIN_PASSWORD. Passwords need 12–128 characters with uppercase, lowercase and a number. URL-encode special characters in database credentials. Never commit `.env`.
3. From the repository root:

```powershell
npm ci
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). API runs on `127.0.0.1:4000`; Vite proxies `/api`. Sign in with the seeded account and change its initial password. Rerunning the seed synchronizes role permissions but **does not reset an existing password or elevate an existing account**. No default password is embedded in source. Remove the initial SEED_ADMIN_PASSWORD from deployment secrets after first provisioning.

Use your existing MySQL server and set `backend/.env` to its host, port, database name and credentials. The `.env` file configures the connection; MySQL must also be running. The backend permits MySQL 8 RSA public key retrieval on loopback connections so password authentication also works after MySQL restarts. Remote connections keep this disabled; use TLS (`?ssl=true`) for remote databases.

The previous project-specific MySQL instance on port `13316` was backed up and removed on November 10, 2026. Its verified SQL exports, uploaded files, previous configuration and complete `.local` archive are in `backups/somity-2026-11-10-before-local-removal/` (gitignored). Follow that folder's `RESTORE.md` to import into your existing MySQL server, then update `DATABASE_URL` before starting the app.

## Structure

```text
frontend/src/
  components/{ui,forms,tables,modals}/  Shared accessible controls
  composables/                        Locale preparation (EN/বাংলা navigation)
  layouts/                            Responsive authenticated shell
  modules/members/                    Directory, editor and profile
  router/ stores/ services/ utils/     Guards, Pinia auth, Axios, formatters
  views/                              Login, password, dashboard and staff
backend/
  prisma/schema.prisma                 Normalized Phase 1 schema
  prisma/migrations/                   Version-controlled MySQL SQL
  prisma/seed.ts                       Roles, permissions, initial superadmin
  prisma7.config.ts                    Pinned Prisma 7 migration configuration
  src/modules/{auth,members,users,uploads,dashboard}/
  src/{config,middleware,services,utils}/
docs/                                  API contract and future database design
```

Authentication keeps access tokens in memory and refresh tokens in a private cookie. Authorization is enforced on API routes and record ownership, including photo downloads. Member archives retain records and disable login. All member mutations and successful login/password/staff events are audited; secrets are excluded. Files stay outside the public web root and are decoded/reencoded before storage. New users must change their initial password before business access. Society Admin can create staff/member logins in their own society; platform Super Admin can create and manage societies. Tenant accounts cannot create platform Super Admins. Member dashboards allow viewing their own profile and approved savings statement only.

Reusable controls include AppForm, AppInput, AppSelect, AppDatePicker, FileUploader, AppTable (sort/pagination), AppModal, ConfirmDialog, StatusBadge, SummaryCard, LoadingState and AppButton. Most interface text is English; the locale composable includes Bangla navigation and core dashboard labels as a foundation for complete translation. Bangla input is supported throughout.

Member and user lists stay separate from entry forms. Add/edit member opens a responsive modal from the directory or profile, and saving refreshes the current list/profile. Nominees have their own list inside the member modal, with separate add/edit dialogs and a visible total allocation. Staff creation uses an independent modal form. Form inputs use 16px text, with larger list/navigation text and comfortable spacing. Existing `/members/new` and `/members/:id/edit` links redirect to the corresponding modal flow.

Replacing a member photo deletes its previous metadata and file. Remove photo is available in the profile and edit modal; modal changes apply when saved and can be undone or canceled first. Filesystem failures stay in a durable cleanup queue and retry at startup/every minute. Apply the photo-cleanup migration before restarting an upgraded API; it also schedules deletion of legacy superseded photos while keeping the latest photo per member.

For local development, use `npm run dev` so the API restarts when source files change. A running `node dist/src/server.js` process retains the old code until it is restarted, even after another build. `/api/health` includes `capabilities.memberPhotoRemoval` and `capabilities.supersededPhotoCleanup`; both should be true for the current API. If these are absent, an older server is still serving requests. Stop that project's old API instance before starting the current one. A port conflict now fails explicitly in the API log.

## Verification

```powershell
npm run typecheck
npm run build
npm test
```

For integration tests create a **separate** schema ending in `_test` and configure `TEST_DATABASE_URL` in `backend/.env` (or the environment). Apply the same committed migrations to it first:

```powershell
cd backend
# Set DATABASE_URL to the TEST_DATABASE_URL value for this migration command only.
$env:DATABASE_URL = 'mysql://USER:PASSWORD@127.0.0.1:3306/somity_test'
npm run db:migrate
Remove-Item Env:DATABASE_URL
cd ..
npm run test:integration
```

The tests refuse a non-test schema. They create uniquely named fixtures and remove only those fixtures afterward. Coverage includes permissions/ownership, passwords, nominee totals, validation, duplicates, search/pagination, temporary password enforcement, protected image uploads, stale edits, audit records, refresh rotation/replay, logout and archive/session revocation. Unit tests need no running database. Browser workflow checks are under `tests/e2e/`; see their instructions there.

## Deployment and later upgrades

Run `npm run build`, then `npm run start -w backend`. Serve `frontend/dist` with SPA history fallback and reverse-proxy `/api` to the API's loopback listener. Set NODE_ENV=production, a matching HTTPS FRONTEND_ORIGIN, a strong secret and persistent private STORAGE_DIR. Configure TRUST_PROXY only for the actual number of trusted reverse-proxy hops. Production refresh cookies require HTTPS. Do not use the Vite dev server for production.

Commit migrations and lockfile. Use `npm run db:dev -w backend -- --name descriptive_name` for new development schema changes, review generated SQL, and apply via `npm run db:migrate` in deployment. Prisma CLI/client/adapter are pinned to the same stable major/version. Do not run `db push` against production. Back up database **and uploaded files** before upgrades; automated/encrypted backups are outside Phase 1.

Phase 1 uses local disk storage and an in-memory rate limiter for one API process. Before scaling replicas, introduce private object storage, a shared rate-limit store, monitored connection pools, session-retention jobs and tested database restore operations. See the database design for double-entry posting, approval locking, decimal precision, idempotency, reversals and the explicit multi-society migration boundary.

Multi-society administration and isolation: [docs/MULTI_SOCIETY.md](docs/MULTI_SOCIETY.md). API details and role matrix: [docs/API.md](docs/API.md). Configuration/security guidance was checked against [Express security practices](https://expressjs.com/advanced/best-practice-security/) and [Prisma's MySQL connector documentation](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/mysql).
