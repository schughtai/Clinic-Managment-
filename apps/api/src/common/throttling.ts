import { SetMetadata } from '@nestjs/common';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import type { AppConfig } from '../config/config';

export const STRICT_RATE = 'strictRate';

/** Applies the tighter rate limit, used for sign-in and other abuse-prone routes. */
export const StrictRate = (): MethodDecorator & ClassDecorator => SetMetadata(STRICT_RATE, true);

/**
 * Two limits: a generous one for every route and a tight one for routes marked StrictRate.
 * Counters live in memory, which is correct for one server process. With several servers,
 * move the counters to a shared store before relying on the limits.
 */
export function throttlerOptions(config: AppConfig): ThrottlerModuleOptions {
  return [
    { name: 'default', ttl: 60_000, limit: config.rateLimitPerMinute },
    {
      name: 'strict',
      ttl: 60_000,
      limit: config.loginRatePerMinute,
      skipIf: (context) => Reflect.getMetadata(STRICT_RATE, context.getHandler()) !== true,
    },
  ];
}
