import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';

/**
 * Serves the built web app from the API so the browser sees one origin (decision 0009).
 * Hashed files under /assets are cached for a year; index.html is never cached so a new release
 * is picked up at once. Every other GET outside /api returns index.html for client-side routing.
 */
export function webAppHandlers(distDir: string): RequestHandler[] {
  const root = path.resolve(distDir);
  const index = path.join(root, 'index.html');
  if (!existsSync(index)) {
    throw new Error(`WEB_DIST_DIR has no index.html: ${root}. Run npm run build first.`);
  }
  const assets = express.static(root, { immutable: true, maxAge: '365d', index: false });
  const files = express.static(root, { index: false, maxAge: '1h' });
  const fallback = (request: Request, response: Response, next: NextFunction): void => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return next();
    if (request.path === '/api' || request.path.startsWith('/api/')) return next();
    response.setHeader('Cache-Control', 'no-cache');
    response.sendFile(index);
  };
  return [
    (request, response, next) => {
      if (!request.path.startsWith('/assets/')) return next();
      // A missing hashed file is a plain 404, never the page, so stale tabs fail clearly.
      assets(request, response, () => {
        response.status(404).type('text/plain').send('Not found');
      });
    },
    (request, response, next) => (request.path === '/' || request.path === '/index.html' ? next() : files(request, response, next)),
    fallback,
  ];
}
