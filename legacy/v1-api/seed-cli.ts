import { seedDemo } from './seed';

/** Adds the demo clinic to an empty database. Development only. */
async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('Demo data must never be added in production.');
  const adminUrl = process.env.ADMIN_DATABASE_URL;
  if (adminUrl === undefined) throw new Error('Set ADMIN_DATABASE_URL first.');
  const result = await seedDemo(adminUrl);
  process.stdout.write(result.seeded ? 'Demo clinic created.\n' : 'The database already has a clinic, so nothing was added.\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
