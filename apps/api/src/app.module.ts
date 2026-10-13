import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { Logger } from 'pino';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { throttlerOptions } from './common/throttling';
import type { AppConfig } from './config/config';
import { CoreModule } from './core.module';
import { HealthController } from './health.controller';
import { AccessGuard } from './modules/auth/access.guard';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { ClinicController } from './modules/clinic/clinic.controller';
import { ClinicService } from './modules/clinic/clinic.service';
import { DoctorsController } from './modules/doctors/doctors.controller';
import { DoctorsService } from './modules/doctors/doctors.service';
import { UsersController } from './modules/users/users.controller';
import { UsersService } from './modules/users/users.service';

@Module({})
export class AppModule {
  static register(config: AppConfig, logger: Logger): DynamicModule {
    return {
      module: AppModule,
      imports: [CoreModule.register(config, logger), ThrottlerModule.forRoot(throttlerOptions(config))],
      controllers: [HealthController, AuthController, ClinicController, UsersController, DoctorsController],
      providers: [
        AuthService,
        ClinicService,
        UsersService,
        DoctorsService,
        // Order matters: the rate limit runs first, then the session and role check.
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: AccessGuard },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    };
  }
}
