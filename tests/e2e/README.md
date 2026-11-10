# Browser verification

Phase 2 adds `finance.spec.ts`: creates a cash account through the Admin UI, submits a deposit as Accountant, approves as Approver, checks the posted society ledger and signs in as Member to verify the private savings statement. It captures the transaction form and member statement on a 390px viewport and checks for page errors/overflow. All financial fixtures use the separate `_test` schema and are removed afterward. Private test uploads now use `test-results/e2e-private-storage`; no `.local` database instance is needed.

Install dependencies and apply both migrations to TEST_DATABASE_URL as described in the root README. A local Chrome browser is used by default; set PLAYWRIGHT_CHANNEL=msedge if preferred, or install Playwright's supported browser. Then run `npm run test:e2e` from the root.

The runner starts a dedicated API on 4100 and frontend on 5174, using only the separate `_test` schema. It creates an isolated superadmin fixture, walks through initial password change, member creation, photo upload, search, edits, login provisioning, read-only member access, refresh/page reload and archival. It verifies a narrow mobile viewport and captures desktop/mobile screenshots in `test-results/`. Fixtures are uniquely identified and only those records are removed after tests. The actual seeded development superadmin's password is not changed by tests.

The workflow also verifies separate member/user entry dialogs, canceled staff draft reset, nominee add/edit dialogs and 60/40 allocation, returning to the directory after creation, nested-dialog Escape behavior, 16px mobile inputs, and modal bounds on a 390px viewport. Screenshots include member, user and nominee entry forms.

Photo checks cover replacement from the edit modal, deletion of superseded metadata and disk files, canceled/undone removal, saved removal, direct profile removal and member viewer restrictions.

The multi-society browser workflow creates two societies and first admins through the UI, switches workspaces, checks an empty directory in the other society and rejects a cross-society profile URL. It then signs in separately as society Admin and Approver, verifies scoped navigation/data and creates an Approver from the society Admin account. Both workflows use only unique fixtures in the _test database.
