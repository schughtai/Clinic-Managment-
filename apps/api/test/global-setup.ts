import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { GlobalSetupContext } from 'vitest/node' with { 'resolution-mode': 'import' };
import { DEV_APP_PASSWORD, startDevDatabase } from '../src/db/dev-server';
import { migrate } from '../src/db/migrate';

declare module 'vitest' {
  export interface ProvidedContext {
    adminUrl: string;
    appUrl: string;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** Starts one real PostgreSQL server for the whole test run and applies every migration to it. */
export default async function setup({ provide }: GlobalSetupContext): Promise<() => Promise<void>> {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'clinic-pg-'));
  const port = await freePort();
  const database = await startDevDatabase({ dataDir, port, ephemeral: true });
  await migrate({ adminUrl: database.adminUrl, appPassword: DEV_APP_PASSWORD });
  provide('adminUrl', database.adminUrl);
  provide('appUrl', database.appUrl);
  return async () => {
    await database.stop();
    rmSync(dataDir, { recursive: true, force: true });
  };
}
