# Society Management System — Development Prompt

Build a modern, simple, secure, and scalable **Society Management System** for managing members, deposits, withdrawals, loans, investments, profits, expenses, and financial reports.

## 1. Technology Stack

**Frontend (Separate Project)**
- Vue.js 3 + Vite
- TypeScript
- Tailwind CSS
- Pinia for state management
- Vue Router
- Axios for API requests
- Reusable UI components and form components
- Responsive admin dashboard

**Backend (Separate Project)**
- Node.js + Express.js
- TypeScript
- MySQL 8
- Prisma ORM
- REST API
- JWT Authentication with refresh tokens
- Zod validation
- Multer for document uploads

## 2. Project Architecture

Create separate frontend and backend projects.

```text
society-management/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/
│   │   │   ├── forms/
│   │   │   ├── tables/
│   │   │   └── modals/
│   │   ├── layouts/
│   │   ├── views/
│   │   ├── modules/
│   │   ├── composables/
│   │   ├── stores/
│   │   ├── services/
│   │   ├── router/
│   │   └── utils/
│   └── package.json
│
├── backend/
│   ├── src/
│   │   ├── config/
│   │   ├── modules/
│   │   ├── middleware/
│   │   ├── services/
│   │   ├── utils/
│   │   └── app.ts
│   ├── prisma/
│   └── package.json
```

Each backend module should follow:

- routes
- controller
- service
- repository (when needed)
- validator

Keep business logic separate from controllers.

## 3. Main Modules

### Authentication & Authorization
- Admin login
- Member login
- Role-based access control
- Roles: Super Admin, Admin, Accountant, Approver, Member
- Members can only view their own financial information.
- Enforce permissions in backend APIs.

### Member Management
- Member registration and unique member number
- Member photo
- Phone, email, address
- Nominee information
- Member status
- Document attachments
- Member profile and history

### Financial Management
- Member deposits
- Member withdrawals
- Loan disbursement
- Loan repayments
- Investment records
- Investment returns and profit distribution
- Income and expenses
- Bank accounts
- Bank deposits and withdrawals
- Member-wise statements
- Society-wide financial ledger

### Approval Workflow
- Configurable one-level or two-level approval
- Create, update, and cancellation requests
- Pending, Approved, Rejected statuses
- Only approved transactions affect the ledger.
- No direct modification of posted ledger entries.
- Corrections must use reversal and replacement transactions.
- Maintain complete audit history.
- Prevent users from approving their own requests when segregation of duties is required.


### Reports
- Member statements
- Daily collection report
- Deposit and withdrawal summary
- Loan outstanding report
- Investment summary and details
- Profit distribution report
- Income and expense report
- Bank balance report
- Society financial summary
- Date-range filters
- PDF and Excel export

### Backup
- Manual MySQL backup
- Scheduled daily backup
- Offline backup download by authorized admin
- Include uploaded documents in backup
- Backup history and restore instructions
- Secure and encrypt backup files.

## 4. Reusable Components

Create reusable components:

- AppTable with pagination, sorting and filtering
- AppForm
- AppInput
- AppSelect
- AppDatePicker
- AppModal
- ConfirmDialog
- FileUploader
- StatusBadge
- AppButton
- ReportFilter
- SummaryCard
- LoadingState

Avoid duplicate code and use common utilities.

## 5. Database Design

Design a normalized MySQL database with foreign keys, indexes, and migrations.

Suggested core entities:

- users
- roles
- permissions
- members
- nominees
- member_documents
- accounts
- bank_accounts
- transactions
- transaction_entries
- approval_requests
- approval_steps
- loans
- loan_repayments
- investments
- investment_documents
- profit_distributions
- expenses
- audit_logs
- backup_logs
- system_settings

Use DECIMAL for monetary values, never floating-point.

Implement double-entry bookkeeping for financial transactions. Ensure database transactions are atomic, balanced and protected from duplicate submissions.

## 6. UI/UX Requirements

- Modern and professional design
- Simple navigation sidebar
- Admin and Member dashboards
- Desktop and mobile responsive
- Reusable forms and tables
- Clear validation and error messages
- Search and filtering
- Loading states and confirmations
- Support Bangladeshi Taka (BDT)
- Prepare architecture for Bangla and English localization.

## 7. Security

- Secure password hashing
- JWT authentication and authorization
- Server-side input validation
- Rate limiting
- Secure file upload validation
- SQL injection protection
- Audit logging
- Role-based API protection
- Sensitive financial data access control
- Environment-based configuration

## 8. Development Rules

**Important: Build incrementally, not all modules at once.**

1. Start with authentication, roles, basic dashboard and member management.
2. Create a working frontend and backend with MySQL integration.
3. Keep each feature independent and modular.
4. Use shared reusable components.
5. Use clean and readable TypeScript.
6. Apply database migrations for schema changes.
7. Do not hardcode business rules that may change.
8. Never use mock financial data in production workflows.
9. Write basic tests for financial calculations, permissions and approval logic.
10. Keep existing functionality working when adding new features.
11. Provide API documentation and `.env.example` files.
12. Do not overengineer the initial version.

## 9. First Development Task — Phase 1

For now, implement ONLY:

- Project initialization
- Frontend and backend folder structure
- MySQL + Prisma configuration
- Authentication
- Role-based authorization
- Admin dashboard layout
- Member CRUD
- Member profile with photo and nominee
- Member list with search and pagination
- Reusable form, table and modal components
- Basic member dashboard (view-only)
- Database migrations and initial admin seed

Do not implement the complete financial system yet.

Before coding, explain the planned database tables, modules, and API endpoints for Phase 1.

Then implement Phase 1 with complete working code.

Ensure all new modules can be added later without rewriting the existing architecture.