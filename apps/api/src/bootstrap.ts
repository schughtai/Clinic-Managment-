import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { AppModule, type AppOverrides } from './app.module';
import { accessLogMiddleware, originCheckMiddleware, requestIdMiddleware } from './common/http-middleware';
import { NestPinoLogger, createLogger } from './common/logger';
import type { AppConfig } from './config/config';

export interface CreatedApp {
  app: NestExpressApplication;
  logger: Logger;
}

/** Builds the application with all security and logging settings. Tests and production use the same function. */
export async function createApp(config: AppConfig, overrides: AppOverrides = {}): Promise<CreatedApp> {
  const logger = createLogger(config.logLevel);
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config, logger, overrides), {
    logger: new NestPinoLogger(logger),
  });

  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(requestIdMiddleware);
  app.use(accessLogMiddleware(logger));
  app.use(originCheckMiddleware(config.allowedOrigins));
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '512kb' });
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: [...config.allowedOrigins],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });
  app.enableShutdownHooks();
  return { app, logger };
}
