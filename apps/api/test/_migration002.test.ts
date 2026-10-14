import { it } from 'vitest';
import { startTestApp } from './support/app';
it('applies migrations', async () => { const t = await startTestApp(); await t.close(); });
