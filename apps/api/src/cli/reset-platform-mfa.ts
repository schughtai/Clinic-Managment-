import { Client } from 'pg';
import { normalizeIdentifier } from '../modules/identity/identity-helpers';
import { adminUrl, fail, parseArgs } from './cli-support';

/**
 * Recovery when a Super Admin lost both their authenticator and their recovery codes. Clears the
 * enrolment and ends their sessions; the next sign-in asks for a new authenticator.
 *
 *   npm run platform:reset-mfa -- --email owner@example.com
 *
 * Run only after confirming the person's identity outside the system. See docs/v2/operations.md.
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const input = args.get('email') ?? args.get('phone');
  if (typeof input !== 'string') fail('Give --email or --phone.');
  const identifier = normalizeIdentifier(input);
  if (identifier === null) fail('That email or phone number is not valid.');

  const client = new Client({ connectionString: adminUrl() });
  await client.connect();
  try {
    await client.query('begin');
    const person = await client.query<{ id: string }>('select id from persons where phone = $1 or email = $1', [identifier]);
    const id = person.rows[0]?.id;
    if (id === undefined) fail('No account has this identifier.');
    await client.query(
      `update persons set mfa_secret_enc = null, mfa_pending_secret_enc = null, mfa_enabled_at = null, mfa_last_step = null where id = $1`,
      [id],
    );
    await client.query('delete from mfa_recovery_codes where person_id = $1', [id]);
    await client.query(`update sessions set revoked_at = now(), revoke_reason = 'mfa_reset' where person_id = $1 and revoked_at is null`, [id]);
    await client.query(
      `insert into platform_audit_events (actor_label, action, target_type, target_id, details)
       values ('operator command', 'platform.mfa_reset', 'person', $1, '{}')`,
      [id],
    );
    await client.query('commit');
    process.stdout.write('Authenticator removed and sessions ended. The next sign-in will ask to set up a new one.\n');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
