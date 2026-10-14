import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from './support/app';

let t: TestApp;
beforeAll(async () => {
  const dist = mkdtempSync(path.join(tmpdir(), 'clinic-web-'));
  mkdirSync(path.join(dist, 'assets'));
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), 'console.log(1)');
  writeFileSync(path.join(dist, 'favicon.svg'), '<svg/>');
  t = await startTestApp({ webDistDir: dist });
});
afterAll(async () => {
  await t.close();
});

describe('serving the web app from the API', () => {
  it('returns index.html for app routes, never cached', async () => {
    for (const route of ['/', '/login', '/app/shifa/dashboard', '/invite']) {
      const response = await t.agent().get(route);
      expect(response.status).toBe(200);
      expect(response.text).toContain('id="root"');
      expect(response.headers['cache-control']).toBe('no-cache');
    }
  });

  it('serves hashed assets with a long cache and 404s missing ones', async () => {
    const asset = await t.agent().get('/assets/app-abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.headers['cache-control']).toContain('immutable');
    expect((await t.agent().get('/assets/missing.js')).status).toBe(404);
    expect((await t.agent().get('/favicon.svg')).status).toBe(200);
  });

  it('leaves the API alone', async () => {
    expect((await t.agent().get('/api/health')).body).toEqual({ status: 'ok' });
    const missing = await t.agent().get('/api/nothing-here');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('not_found');
  });

  it('does not answer unsafe methods with the page', async () => {
    expect((await t.agent().post('/app/shifa/dashboard').send({})).status).toBe(404);
  });
});
