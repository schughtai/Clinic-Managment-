import { type DynamicModule, Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import type { Logger } from 'pino';
import { AuditService } from './common/audit.service';
import { LOGGER } from './common/tokens';
import { CONFIG, type AppConfig } from './config/config';
import { DbService } from './db/db.service';
import { PasswordService } from './modules/auth/password.service';
import { SessionService } from './modules/auth/session.service';

/** Services every feature module needs: configuration, logging, the database, sessions and audit. */
@Global()
@Module({})
export class CoreModule {
  static register(config: AppConfig, logger: Logger): DynamicModule {
    return {
      module: CoreModule,
      imports: [
        JwtModule.register({
          secret: config.sessionSecret,
          signOptions: { algorithm: 'HS256', expiresIn: config.sessionHours * 3600 },
        }),
      ],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: LOGGER, useValue: logger },
        DbService,
        AuditService,
        PasswordService,
        SessionService,
      ],
      exports: [CONFIG, LOGGER, DbService, AuditService, PasswordService, SessionService],
    };
  }
}
