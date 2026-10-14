import bcrypt from 'bcryptjs';
import { Client } from 'pg';
import { normalizeIdentifier, newPasswordSchema } from '../modules/identity/identity-helpers';
import { adminUrl, fail, parseArgs, promptHidden } from './cli-support';

/**
 * Creates the first Super Admin (FR-013). Never possible through the web interface.
 *
 *   npm run platform:create-admin -- --name "Owner" --email owner@example.com
 *   npm run platform:create-admin -- --name "Owner" --phone 03001234567 --password-env OWNER_PASSWORD
 *   npm run platform:create-admin -- --email someone@example.com --promote   (existing account)
 *
 * The authenticator is set up at first sign-in.
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const name = args.get('name');
  const emailArg = args.get('email');
  const phoneArg = args.get('phone');
  const promote = args.get('promote') === true;
  const identifierInput = typeof emailArg === 'string' ? emailArg : typeof phoneArg === 'string' ? phoneArg : undefined;
  if (identifierInput === undefined) fail('Give --email or --phone.');
  const identifier = normalizeIdentifier(identifierInput);
  if (identifier === null) fail('That email or phone number is not valid.');
  const isEmail = identifier.includes('@');

  const client = new Client({ connectionString: adminUrl() });
  await client.connect();
  try {
    const existing = await client.query<{ id: string }>(`select id from persons where ${isEmail ? 'email' : 'phone'} = $1`, [identifier]);
    let personId = existing.rows[0]?.id;
    if (personId !== undefined && !promote) {
      fail('An account with this identifier already exists. Add --promote to make it a Super Admin.');
    }
    if (personId === undefined) {
      if (typeof name !== 'string' || name.trim() === '') fail('Give --name for a new account.');
      const passwordEnv = args.get('password-env');
      const password =
        typeof passwordEnv === 'string' ? (process.env[passwordEnv] ?? fail(`Environment variable ${passwordEnv} is empty.`)) : await promptHidden('Password: ');
      const checked = newPasswordSchema.safeParse(password);
      if (!checked.success) fail(checked.error.issues[0]?.message ?? 'Password is not valid.');
      if (typeof passwordEnv !== 'string' && (await promptHidden('Repeat password: ')) !== password) fail('The passwords do not match.');
      const hash = await bcrypt.hash(password, 12);
      const created = await client.query<{ id: string }>(
        `insert into persons (display_name, ${isEmail ? 'email' : 'phone'}, password_hash) values ($1, $2, $3) returning id`,
        [name.trim(), identifier, hash],
      );
      personId = created.rows[0]!.id;
    }
    await client.query('insert into platform_admins (person_id) values ($1) on conflict do nothing', [personId]);
    await client.query(
      `insert into platform_audit_events (actor_label, action, target_type, target_id, details)
       values ('operator command', 'platform.admin_granted', 'person', $1, '{}')`,
      [personId],
    );
    process.stdout.write('Super Admin ready. Sign in on the web app; you will be asked to set up an authenticator app first.\n');
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
