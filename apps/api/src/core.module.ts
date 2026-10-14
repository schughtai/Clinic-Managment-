import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { Logger } from 'pino';
import { LOGGER } from './common/tokens';
import { CONFIG, type AppConfig } from './config/config';
import { DbService } from './db/db.service';

/** Services every feature module needs: configuration, logging and the database. */
@Global()
@Module({})
export class CoreModule {
  static register(config: AppConfig, logger: Logger): DynamicModule {
    return {
      module: CoreModule,
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: LOGGER, useValue: logger },
        DbService,
      ],
      exports: [CONFIG, LOGGER, DbService],
    };
  }
}
