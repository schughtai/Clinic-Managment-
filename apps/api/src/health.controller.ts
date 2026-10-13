import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from './common/access';
import { DbService } from './db/db.service';

@Public()
@SkipThrottle({ default: true, strict: true })
@Controller('health')
export class HealthController {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  /** The process is running. Used by the host to decide whether to restart it. */
  @Get()
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** The database answers. Used by the host to decide whether to send traffic here. */
  @Get('ready')
  async ready(): Promise<{ status: 'ready' }> {
    try {
      await this.db.ping();
    } catch {
      throw new ServiceUnavailableException();
    }
    return { status: 'ready' };
  }
}
