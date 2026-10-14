# Quickstart: validating Platform and Tenant Foundation

## Prerequisites

- Node 20.10 or newer. No database install: development and tests use embedded PostgreSQL.
- An authenticator app (any TOTP app) for the Super Admin, or the development code printer below.

## Automated checks (must all pass)

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

`npm test` runs the API suite on a real PostgreSQL and the web component tests. The isolation
suite (`apps/api/test/isolation.test.ts`) must cover every route in [contracts/api.md](contracts/api.md).

## Run the app

```bash
npm run dev
```

Opens the API on :3001 and the web app on http://localhost:3000. Data lives in `apps/api/data`;
delete it to start fresh. The console prints the demo accounts (synthetic data): one Super Admin,
"Shifa Health Clinic" (admin, receptionist limited to one branch, finance) and "City Medical
Centre" (admin). Development prints the Super Admin's current one-time code every 30 seconds when
`DEV_PRINT_TOTP=true`.

## Manual scenarios

1. **Bootstrap**: on a fresh database run
   `npm run platform:create-admin --workspace apps/api -- --name "Owner" --email owner@example.test`.
   Sign in at `/login`; you are sent to enrol MFA; scan the QR code, enter a code, save the
   recovery codes; you land on `/platform`.
2. **Onboard (Story 1)**: create organization "Test Clinic" slug `test-clinic` with one facility.
   Status shows *Setup required*. Invite an admin; copy the link. In a private window open it, set
   a password, land on `/app/test-clinic/dashboard` with the setup checklist.
3. **Setup (Story 3)**: fill organization profile and facility address, timezone and hours. The
   checklist turns green; press *Activate*. Invite a Receptionist limited to the first facility.
4. **Routing and permissions (Story 2)**: sign in as the Receptionist. The sidebar shows only
   Dashboard. Visiting `/app/test-clinic/settings/staff` shows the access-denied state; the API
   call returns 403. Visiting `/app/city-medical/dashboard` shows not-found.
5. **Lifecycle (Story 4)**: as the admin, deactivate the Receptionist while their window is open;
   their next click shows the signed-out message. Reset a password; the old one fails; the link
   works once.
6. **Suspension (Story 5)**: as Super Admin suspend Test Clinic with a reason; the admin's next
   request shows *organization suspended*. Reactivate; data is intact. Turn the clinical module
   on and off; the Practitioner role becomes assignable only while on.
7. **Audit (Story 6)**: as the admin open Audit and find each action above with actor and time;
   City Medical's admin sees none of them. The platform audit shows the suspension.
8. **Responsive and language**: at 375 px width there is no horizontal scroll; switching to Urdu
   flips the layout right-to-left.

## Expected outcomes

All scenarios behave as described; spec success criteria SC-001 to SC-006 are met.
