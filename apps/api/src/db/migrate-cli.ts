import { migrate, passwordFromUrl } from './migrate';

/** Applies pending migrations. Run this on every deployment, before the new version starts. */
async function main(): Promise<void> {
  const adminUrl = process.env.ADMIN_DATABASE_URL;
  const appUrl = process.env.DATABASE_URL;
  if (adminUrl === undefined || appUrl === undefined) {
    throw new Error('Set ADMIN_DATABASE_URL and DATABASE_URL before running migrations.');
  }
  const applied = await migrate({ adminUrl, appPassword: passwordFromUrl(appUrl) });
  process.stdout.write(applied.length === 0 ? 'Database is up to date.\n' : `Applied: ${applied.join(', ')}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
