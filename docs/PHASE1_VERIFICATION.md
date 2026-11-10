# Phase 1 verification

Verified on 9 November 2026 (Asia/Dhaka), Windows, Node 24 and isolated MySQL 8.0.46. Prisma CLI/client/MySQL adapter are pinned to 7.10.1. Existing MySQL services and their databases were not modified.

| Check | Result |
| --- | --- |
| TypeScript backend + Vue typecheck | Passed |
| Backend + Vite production build | Passed |
| Unit tests | 4 passed: permission/ownership, exact nominee share totals, salted password verification, private storage boundaries |
| MySQL API integration tests | 24 passed, including 9 multi-society isolation tests |
| Chrome browser workflows | 2 passed: member/photo workflows on desktop/mobile, and multi-society creation/switching with distinct Admin/Approver logins |
| npm dependency audit | 0 vulnerabilities after patched dependency upgrades |
| Migrations | All 4 committed migrations applied to isolated development and test schemas |
| Repeated seed | Existing superadmin credentials preserved; role permissions synchronized |

API coverage: trusted origin and credentials, unauthenticated/unauthorized requests, member creation/nominees, duplicate email and invalid input, search/pagination, staff provisioning, mandatory first password change, member ownership, photo bytes/MIME/size validation, protected own/other document access, atomic/stale-version edits, audit events, refresh rotation/replay, logout and archival/session invalidation.

Photo lifecycle coverage verifies deletion of superseded metadata and disk files, concurrent replacements retaining only one current image, rejected uploads preserving the existing image, stale/unauthorized removal rejection, removal/retry auditing, other document preservation and durable retry after filesystem deletion failure. Browser checks also cover removal from both the edit modal and profile, cancel/undo before saving, and viewer restrictions.

Browser coverage: initial password change, admin dashboard, member creation with Bangla nominee input, protected photo rendering, edit, member login provisioning, search, mobile navigation/overflow check, member-only dashboard, page reload/session refresh and archival. Test fixtures are confined to the `_test` schema and cleaned afterward. Screenshots are in `test-results/phase1-complete-admin-and--3f92c-flows-on-desktop-and-mobile/` after a browser run.

Financial posting/approval, exports, encrypted offline backups and production hosting are outside Phase 1 and have not been claimed as implemented or tested. The design document explains the later financial invariants and growth boundaries. Full Bangla translation is also a later UI improvement; Phase 1 includes Bangla input and a locale foundation with core navigation/dashboard labels.

Multi-society migration was additionally rehearsed against a temporary restored copy of the pre-migration database. Existing member/nominee/photo/user IDs were preserved, and legacy Admin/Member fixtures migrated to scoped memberships correctly. Composite FK and HTTP isolation checks passed. Current app capabilities advertise multiSociety=true.
