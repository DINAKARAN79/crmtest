# DCT-CRM

Enterprise Multi-Tenant CRM with dynamic object management, role-based access control, and permission-based authorization.

## Tech Stack

- **Frontend:** Next.js 14 (App Router), shadcn/ui, TypeScript
- **Backend:** Express.js, TypeScript
- **Database:** PostgreSQL, Prisma ORM
- **Auth:** JWT (HTTP-only cookies)

## Features

- Multi-tenant architecture with Super Admin
- Dynamic Object Manager (create custom objects/fields at runtime)
- Role-based access control (RBAC) with profiles, permission sets, and direct permissions
- 100 granular permissions across 20 modules
- Standard Lead fields (27 fields with picklists)
- Dynamic forms, tables, and detail views
- CRM workflow engine with status transitions
- Audit logging and activity tracking

## Super Admin platform reporting

The independent platform reporting area is available at `/platform-reporting`
for authenticated Super Admin users. It uses dedicated `/api/super-admin/reporting`
endpoints and saved platform definitions; tenant dashboard and report settings
do not control or grant access to this data.

The registry is derived from the generated Prisma model metadata. It exposes
platform-wide `Tenant` and `Permission` data plus eligible models with a direct
`tenantId` ownership field. Sensitive/authentication models and fields, JSON and
binary fields, and models without a safely enforceable tenant owner are omitted.
Supported to-one relationships can be used as validated report filters; report
selection uses fields on the selected object, and grouping also supports the
validated tenant-name dimension for tenant-owned records.

Reports support all-tenant or selected-tenant scope, filters, AND/OR filter
groups, grouping, count/sum/average/min/max aggregates, sorting, pagination,
saved CRUD operations, and CSV export for raw-record reports. Dashboard
definitions are separate from tenant dashboards and contain reusable report
widgets with saved query definitions, scope, ordering, and size settings.
Tenant analytics currently compares per-company lead counts. Platform overview
booking values and approved CRM payment collections are shown separately and by
tenant currency; they are not combined into a single revenue figure.

Use the Prisma schema to create an empty development database. The repository's
existing migration history contains incomplete and failed entries; do not use
`prisma migrate deploy` as a fresh-clone setup or as a recovery shortcut. A
reviewed production migration/reconciliation path is still required before
deploying schema changes to an existing database.

For an existing database, first take a verified backup and inspect migration
state with `npx prisma migrate status --schema packages/db/prisma/schema.prisma`.
If Prisma reports applied migrations missing from this checkout, pending
migrations after a failed migration, or a history mismatch, stop: do not run
`migrate deploy`, `migrate resolve`, or `db push` until the physical schema and
migration ledger have been reconciled for that database.

## Getting Started

```bash
# Install dependencies
npm install

# Set up an empty local/development database
npm run db:generate
npm run db:push
npm run db:seed-super-admin
npm run db:seed
npm run db:seed:standard-metadata

# Start API server
cd apps/api
npm run dev

# Start Web server
cd apps/web
npm run dev
```

`db:push` is for an empty local/development database, not for production
upgrades. `db:seed:standard-metadata` additively fills missing standard Lead,
Salesforce, and Unit metadata for active tenants. It preserves existing field
definitions, picklist choices, layout sections, and tenant data.

## Login Credentials

| Email                   | Password    | Role        |
| ----------------------- | ----------- | ----------- |
| superadmin@dctcrm.com   | password123 | Super Admin |
| admin@dctcrm.com        | password123 | Admin       |
| salesmanager@dctcrm.com | password123 | Manager     |
| priya@dctcrm.com        | password123 | Sales       |
| amit@dctcrm.com         | password123 | Sales       |
| neha@dctcrm.com         | password123 | Presales    |
| finance@dctcrm.com      | password123 | Finance     |

## Test Users

The profile seed command creates or reuses these local test users in the
`dct-re` tenant. The password is hashed in the database and is intended only
for local testing.

| Profile | Username | Password |
|---|---|---|
| Admin | admin.test1@dctcrm.com | DctTest@123 |
| Admin | admin.test2@dctcrm.com | DctTest@123 |
| Admin | admin.test3@dctcrm.com | DctTest@123 |
| Presales | presales.test1@dctcrm.com | DctTest@123 |
| Presales | presales.test2@dctcrm.com | DctTest@123 |
| Presales | presales.test3@dctcrm.com | DctTest@123 |
| SVC | svc.test1@dctcrm.com | DctTest@123 |
| SVC | svc.test2@dctcrm.com | DctTest@123 |
| SVC | svc.test3@dctcrm.com | DctTest@123 |
| Sales | sales.test1@dctcrm.com | DctTest@123 |
| Sales | sales.test2@dctcrm.com | DctTest@123 |
| Sales | sales.test3@dctcrm.com | DctTest@123 |
| CRM | crm.test1@dctcrm.com | DctTest@123 |
| CRM | crm.test2@dctcrm.com | DctTest@123 |
| CRM | crm.test3@dctcrm.com | DctTest@123 |
| Finance | finance.test1@dctcrm.com | DctTest@123 |
| Finance | finance.test2@dctcrm.com | DctTest@123 |
| Finance | finance.test3@dctcrm.com | DctTest@123 |
| Manager | manager.test1@dctcrm.com | DctTest@123 |
| Manager | manager.test2@dctcrm.com | DctTest@123 |
| Manager | manager.test3@dctcrm.com | DctTest@123 |
| Recovery | recovery.test1@dctcrm.com | DctTest@123 |
| Recovery | recovery.test2@dctcrm.com | DctTest@123 |
| Recovery | recovery.test3@dctcrm.com | DctTest@123 |

## Test Login

1. Start the application with `npm run dev`.
2. Open `http://localhost:3000/login`.
3. Use a profile-specific test user above.
4. Verify the displayed profile and test its effective permissions.

### Channel Partner Portal

The CP portal runs separately at `http://localhost:3002/login`. Its accounts
are separate from CRM users and are not created by the CRM test-user seed.
Sign in to the CRM as an administrator, open **Setup → CP Portal Accounts**,
and create a portal account before signing in with its username or email and
password.

Local service URLs:

- Web: `http://localhost:3000`
- API: `http://localhost:3001`
- AI: `http://localhost:8001`
- CP Portal: `http://localhost:3002`

### Lead API test users

Lead creation is allowed for:

- `admin.test1@dctcrm.com`
- `admin.test2@dctcrm.com`
- `admin.test3@dctcrm.com`
- `presales.test1@dctcrm.com`
- `presales.test2@dctcrm.com`
- `presales.test3@dctcrm.com`

Lead creation is denied for negative API tests using:

- `sales.test1@dctcrm.com`
- `svc.test1@dctcrm.com`
- `crm.test1@dctcrm.com`
- `finance.test1@dctcrm.com`
- `manager.test1@dctcrm.com`
- `recovery.test1@dctcrm.com`

## Project Structure

```
dct-crm/
├── apps/
│   ├── api/          # Express.js backend
│   └── web/          # Next.js frontend
├── packages/
│   ├── db/           # Prisma schema & migrations
│   └── shared/       # Shared Zod schemas
```

## Lead duplicate handling

Manual Lead creation is processed by the backend `processLeadEnquiry` service.
It validates contact data, checks for duplicates inside the create transaction,
and only sends a genuinely new Lead through the existing assignment workflow.
An exact phone match is linked to the oldest matching Lead and receives a
source-specific `Enquiry` record; unresolved country-code ambiguity and
multiple email-only matches are returned as conflicts for review. This repository does not
contain Salesforce `SLeadTrigger` or `RelatedSourceHandler.duplicateCheck2()`
source code; the equivalent source-history model here is `Enquiry`.

Phone matching compares all three submitted phone slots with stored Lead phone
slots and phone slots on related `Enquiry` records. Formatting is removed and
country calling codes are included in normalized identities. Email matching
trims whitespace and ignores case across primary and secondary email slots.
Manual creation, GRE, Channel Partner Portal, and CSV Lead imports use the
backend matcher. CSV Lead rows are normalized and matched in one batched lookup,
then processed under one transaction with sorted contact locks; a conflict or
invalid row rolls back the entire import. Enquiries for a different project
are attached to the existing Lead without replacing its primary project
association.

Apply the additive country-code columns and normalized lookup indexes before
starting an API built with this change:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f packages/db/migrations/20261011_lead_duplicate_detection.sql
```

Lead detail queries also load related Opportunities. Ensure the database has
the nullable `Opportunity.notes` column expected by the Prisma schema:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f packages/db/migrations/20261011_opportunity_notes.sql
```

Run focused backend checks with:

```bash
node node_modules/typescript/bin/tsc --noEmit -p apps/api/tsconfig.json
node node_modules/vitest/vitest.mjs run apps/api/src
```

The database-backed concurrency test is opt-in. Run it against a local seeded
database with:

```bash
LEAD_DUPLICATE_INTEGRATION=1 node node_modules/vitest/vitest.mjs run \
  apps/api/src/services/enquiryProcessing.integration.test.ts
```
# crm
