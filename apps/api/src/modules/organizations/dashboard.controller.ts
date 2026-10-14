import { Controller, Get, Inject } from '@nestjs/common';
import { Permission } from '../../common/access';
import { Ctx, orgOf, type ReqCtx } from '../../common/request-context';
import { DbService } from '../../db/db.service';
import { orgDb } from '../identity/access.guard';
import { setupChecks, type SetupCheck } from './setup-checks';

export interface DashboardResult {
  status: string;
  setupChecks: SetupCheck[];
  counts: { facilities: number; activeStaff: number; pendingInvitations: number };
}

@Controller('orgs/:slug')
export class DashboardController {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  /** What needs attention now. Feature 002 adds appointment, queue and billing figures here. */
  @Permission('dashboard.read')
  @Get('dashboard')
  dashboard(@Ctx() ctx: ReqCtx): Promise<DashboardResult> {
    const org = orgOf(ctx);
    return this.db.withContext(orgDb(ctx), async (tx) => {
      const counts = await tx.one<{ facilities: number; active_staff: number; pending: number }>(
        `select
           (select count(*)::int from facilities where active) as facilities,
           (select count(*)::int from memberships where status = 'active') as active_staff,
           (select count(*)::int from invitations where status = 'pending' and expires_at > now()) as pending`,
      );
      return {
        status: org.status,
        setupChecks: org.status === 'setup_required' ? await setupChecks(tx, org.id) : [],
        counts: { facilities: counts.facilities, activeStaff: counts.active_staff, pendingInvitations: counts.pending },
      };
    });
  }
}
