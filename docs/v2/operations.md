# Operations

## Operator commands

Run with `ADMIN_DATABASE_URL` set (locally) or through `railway run` (staging/production). Use the
`:prod` variants on a host, where only built files exist.

| Command | Purpose |
|---|---|
| `npm run platform:create-admin -- --name "Owner" --email owner@example.com` | Create the first Super Admin (prompts for the password; `--password-env NAME` reads it from an environment variable; `--promote` upgrades an existing account) |
| `npm run platform:reset-mfa -- --email owner@example.com` | Remove a Super Admin's authenticator and recovery codes and end their sessions |
| `npm run db:migrate` | Apply database migrations (needs both database URLs) |

## Lost authenticator

1. The person first tries one of their recovery codes on the sign-in page ("Use a recovery code").
2. If they have none left, a second Super Admin, or the operator with database access, confirms the
   person's identity outside the system (a call to a known number, in person).
3. Run `platform:reset-mfa`. The action is written to the platform audit log.
4. The person signs in and sets up a new authenticator.

Keep at least two Super Admins so step 2 never depends on one person.

## Staff password resets

Organization administrators reset staff passwords from the Staff page; a Super Admin can reset an
organization administrator's password from the organization's page. Both produce a one-time link
valid for 24 hours and end the person's sessions. There is no self-service reset until an email or
SMS provider is added.
