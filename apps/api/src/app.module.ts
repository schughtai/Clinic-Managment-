import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { Logger } from 'pino';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { throttlerOptions } from './common/throttling';
import type { AppConfig } from './config/config';
import { CoreModule } from './core.module';
import { HealthController } from './health.controller';
import { AccessGuard } from './modules/identity/access.guard';

@Module({})
export class AppModule {
  static register(config: AppConfig, logger: Logger): DynamicModule {
    return {
      module: AppModule,
      imports: [CoreModule.register(config, logger), ThrottlerModule.forRoot(throttlerOptions(config))],
      controllers: [HealthController],
      providers: [
        // Order matters: the rate limit runs first, then the session and permission check.
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: AccessGuard },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    };
  }
}
