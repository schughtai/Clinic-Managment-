import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { Logger } from 'pino';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { throttlerOptions } from './common/throttling';
import type { AppConfig } from './config/config';
import { CoreModule } from './core.module';
import { HealthController } from './health.controller';
import { AuditController } from './modules/audit/audit.controller';
import { ScheduleController } from './modules/schedule/schedule.controller';
import { ScheduleService } from './modules/schedule/schedule.service';
import { AppointmentsController } from './modules/appointments/appointments.controller';
import { AppointmentsService } from './modules/appointments/appointments.service';
import { QueueService } from './modules/queue/queue.service';
import { AccessGuard } from './modules/identity/access.guard';
import { AuthController } from './modules/identity/auth.controller';
import { AuthService } from './modules/identity/auth.service';
import { DashboardController } from './modules/organizations/dashboard.controller';
import { SettingsController } from './modules/organizations/settings.controller';
import { SettingsService } from './modules/organizations/settings.service';
import { ResetsController } from './modules/staff/resets.controller';
import { StaffController } from './modules/staff/staff.controller';
import { StaffService } from './modules/staff/staff.service';
import { LifecycleService } from './modules/platform/lifecycle.service';
import { OrganizationsService } from './modules/platform/organizations.service';
import { PlatformController } from './modules/platform/platform.controller';
import { InvitationsController } from './modules/staff/invitations.controller';
import { InvitationsService } from './modules/staff/invitations.service';

@Module({})
export class AppModule {
  static register(config: AppConfig, logger: Logger): DynamicModule {
    return {
      module: AppModule,
      imports: [CoreModule.register(config, logger), ThrottlerModule.forRoot(throttlerOptions(config))],
      controllers: [HealthController, AuthController, InvitationsController, PlatformController, DashboardController, SettingsController, StaffController, ResetsController, AuditController, ScheduleController, AppointmentsController],
      providers: [
        AuthService,
        InvitationsService,
        OrganizationsService,
        LifecycleService,
        ScheduleService,
        AppointmentsService,
        QueueService,
        SettingsService,
        StaffService,
        // Order matters: the rate limit runs first, then the session and permission check.
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: AccessGuard },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    };
  }
}
