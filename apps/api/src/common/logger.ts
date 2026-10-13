import type { LoggerService } from '@nestjs/common';
import pino, { type Logger } from 'pino';

/** Structured JSON logger. Passwords, cookies and request bodies are never logged. */
export function createLogger(level: string): Logger {
  return pino({
    level,
    redact: {
      paths: ['req.headers.cookie', 'req.headers.authorization', 'password', '*.password', 'token', '*.token'],
      censor: '[redacted]',
    },
    base: { service: 'clinic-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

/** Lets Nest's own startup and error messages flow through the same structured logger. */
export class NestPinoLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, ...rest: unknown[]): void {
    // Route mapping and module start-up lines are noise at normal levels.
    const context = rest[0];
    const quiet = context === 'RouterExplorer' || context === 'RoutesResolver' || context === 'InstanceLoader';
    if (quiet) this.logger.debug({ context }, String(message));
    else this.logger.info({ context }, String(message));
  }
  error(message: unknown, ...rest: unknown[]): void {
    this.logger.error({ context: rest.at(-1), trace: rest.length > 1 ? rest[0] : undefined }, String(message));
  }
  warn(message: unknown, ...rest: unknown[]): void {
    this.logger.warn({ context: rest[0] }, String(message));
  }
  debug(message: unknown, ...rest: unknown[]): void {
    this.logger.debug({ context: rest[0] }, String(message));
  }
  verbose(message: unknown, ...rest: unknown[]): void {
    this.logger.trace({ context: rest[0] }, String(message));
  }
}
