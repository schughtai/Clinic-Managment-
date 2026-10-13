import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { Logger } from 'pino';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { throttlerOptions } from './common/throttling';
import type { AppConfig } from './config/config';
import { CoreModule } from './core.module';
import { HealthController } from './health.controller';
import { AiService } from './modules/ai/ai.service';
import { AI_PROVIDER, type AiProvider } from './modules/ai/ai.types';
import { AnthropicTransport } from './modules/ai/anthropic.transport';
import { ClaudeAiProvider, DisabledAiProvider } from './modules/ai/claude-ai.provider';
import { AccessGuard } from './modules/auth/access.guard';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { AppointmentsController } from './modules/appointments/appointments.controller';
import { AppointmentsRepository } from './modules/appointments/appointments.repository';
import { AppointmentsService } from './modules/appointments/appointments.service';
import { ClinicController } from './modules/clinic/clinic.controller';
import { ClinicService } from './modules/clinic/clinic.service';
import { DoctorsController } from './modules/doctors/doctors.controller';
import { DoctorsService } from './modules/doctors/doctors.service';
import { PatientsController } from './modules/patients/patients.controller';
import { PatientsRepository } from './modules/patients/patients.repository';
import { PatientsService } from './modules/patients/patients.service';
import { FILE_STORAGE, LocalFileStorage } from './modules/files/file-storage';
import { PrescriptionsController } from './modules/prescriptions/prescriptions.controller';
import { PrescriptionsService } from './modules/prescriptions/prescriptions.service';
import { UsersController } from './modules/users/users.controller';
import { UsersService } from './modules/users/users.service';
import { VisitAccess } from './modules/visits/visit-access';
import { VisitsController } from './modules/visits/visits.controller';
import { VisitsRepository } from './modules/visits/visits.repository';
import { VisitsService } from './modules/visits/visits.service';

/** Parts that tests replace, so they never call real outside services. */
export interface AppOverrides {
  aiProvider?: AiProvider;
}

@Module({})
export class AppModule {
  static register(config: AppConfig, logger: Logger, overrides: AppOverrides = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [CoreModule.register(config, logger), ThrottlerModule.forRoot(throttlerOptions(config))],
      controllers: [
        HealthController,
        AuthController,
        ClinicController,
        UsersController,
        DoctorsController,
        PatientsController,
        AppointmentsController,
        VisitsController,
        PrescriptionsController,
      ],
      providers: [
        AuthService,
        ClinicService,
        UsersService,
        DoctorsService,
        PatientsRepository,
        PatientsService,
        AppointmentsRepository,
        AppointmentsService,
        VisitsRepository,
        VisitAccess,
        VisitsService,
        PrescriptionsService,
        AiService,
        {
          provide: AI_PROVIDER,
          useValue:
            overrides.aiProvider ??
            (config.anthropicApiKey === undefined ? new DisabledAiProvider() : new ClaudeAiProvider(new AnthropicTransport(config))),
        },
        { provide: FILE_STORAGE, useValue: new LocalFileStorage(config.uploadDir) },
        // Order matters: the rate limit runs first, then the session and role check.
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: AccessGuard },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    };
  }
}
