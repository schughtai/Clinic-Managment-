import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Logger } from 'pino';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Gives every request an id that appears in logs, error responses and the x-request-id header. */
export function requestIdMiddleware(request: Request, response: Response, next: NextFunction): void {
  const incoming = request.header('x-request-id');
  const requestId = incoming !== undefined && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  request.requestId = requestId;
  response.setHeader('x-request-id', requestId);
  next();
}

/** One structured line per request. Query strings and bodies are left out because they can hold personal data. */
export function accessLogMiddleware(logger: Logger) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const started = process.hrtime.bigint();
    response.on('finish', () => {
      const milliseconds = Number(process.hrtime.bigint() - started) / 1_000_000;
      logger.info(
        {
          requestId: request.requestId,
          method: request.method,
          path: request.path,
          status: response.statusCode,
          ms: Math.round(milliseconds),
          userId: request.user?.id,
        },
        'request',
      );
    });
    next();
  };
}

/**
 * Cookie sessions are sent automatically by browsers, so a hostile site could try to submit a form to
 * this API. Browsers always send an Origin header on such requests. Refuse any state-changing request
 * whose origin is not on the allowed list. Requests without an Origin come from tools, not browsers.
 */
export function originCheckMiddleware(allowedOrigins: readonly string[]) {
  const allowed = new Set(allowedOrigins);
  return (request: Request, response: Response, next: NextFunction): void => {
    if (SAFE_METHODS.has(request.method)) return next();
    const origin = request.header('origin');
    if (origin === undefined || allowed.has(origin)) return next();
    response.status(403).json({
      error: { code: 'origin_not_allowed', message: 'This request came from an unknown site.', requestId: request.requestId },
    });
  };
}
