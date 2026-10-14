# v2 progress log

## 2026-10-14 — Feature 001: platform and tenant foundation

Built with Spec Kit: constitution 1.0.0, spec, analysis, plan, 87 tasks
(`specs/001-platform-tenant-foundation`). v1 domain code moved to `legacy/` (tag `v1-final`).

### What was verified, and how

| Check | Result |
| --- | --- |
| API tests on a real PostgreSQL (`npm test`) | 157 passed: RLS (10), RFC 6238 vectors and sealing (13), DB role guard (3), sign-in and context (9), MFA (5), platform (5), invitations (6), organizations (5), staff and resets (9), lifecycle (6), audit (4), isolation of every route (44), static serving (4), helpers (34) |
| Web tests | 7 passed: voice field (3), permission-driven menu and access denied (4) |
| Type check, lint, production build (both apps) | clean |
| `npm audit --omit=dev` | 0 findings |
| Browser, development: Super Admin password + authenticator → platform console | worked |
| Browser: receptionist limited to one branch sees one branch; other organization → not found | worked |
| Browser: organization settings, branches, staff, roles, audit pages render with demo data | worked |
| 375 px width, English and Urdu (RTL), every workspace page | no horizontal scroll |
| Contrast of every design token pair (WCAG 2.2 AA) | passes after fixing two pairs |
| Railway build of `main` | builds; start waits for `MFA_ENCRYPTION_KEY` (by design) |

Bugs found and fixed while testing: members with no branch were sent to the dashboard; the
signed-out check marked sessions as ended on the login page; the dev API took the preview tool's
port; a missing hashed asset returned 500 instead of 404; v1's `.gitignore` had kept the
import/export module out of git.

### Not verified yet

- Clicking through invitation, reset and lifecycle dialogs in the browser (the pane was not
  drawing); the same flows are covered by API tests.
- Staging: sign-in on https://clinic-staging-6c6f.up.railway.app after the key is set; Super Admin
  bootstrap with `railway run`; backups and a restore test (T056, T057).
- Urdu wording review by a native reader; speaking into a real microphone.
- Measured task times for SC-001/SC-002 (create organization < 3 min, setup < 10 min).

### Next

1. Set `MFA_ENCRYPTION_KEY` on Railway, bootstrap the Super Admin, run quickstart scenarios 1–4 on
   staging, enable backups and test a restore.
2. Feature 002 (patients with provenance history and voice input, appointments and queue, billing
   with refunds): `/speckit-plan` then `/speckit-tasks`.
