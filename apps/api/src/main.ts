import { createApp } from './bootstrap';
import { loadConfig } from './config/config';

async function main(): Promise<void> {
  const config = loadConfig();
  const { app, logger } = await createApp(config);
  await app.listen(config.port);
  logger.info({ port: config.port, env: config.nodeEnv }, 'clinic api listening');
}

main().catch((error: unknown) => {
  // Configuration and startup failures must be visible and stop the process.
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
