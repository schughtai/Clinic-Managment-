import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { Permission } from '../../common/access';
import { Ctx, type ReqCtx } from '../../common/request-context';
import { parse, parseId } from '../../common/validate';
import { inviteeSchema } from '../platform/platform.controller';
import { StaffService } from './staff.service';

const accessSchema = z.object({
  roleIds: z.array(z.string().uuid()).min(1, 'Choose at least one role.').max(10),
  facilityScope: z.enum(['all', 'selected']),
  facilityIds: z.array(z.string().uuid()).max(200).default([]),
});

const inviteSchema = z.intersection(inviteeSchema, accessSchema);

@Controller('orgs/:slug')
export class StaffController {
  constructor(@Inject(StaffService) private readonly staff: StaffService) {}

  @Permission('staff.read')
  @Get('staff')
  list(@Ctx() ctx: ReqCtx) {
    return this.staff.list(ctx);
  }

  @Permission('role.read')
  @Get('roles')
  roles(@Ctx() ctx: ReqCtx) {
    return this.staff.roles(ctx);
  }

  @Permission('staff.invite')
  @Post('invitations')
  invite(@Ctx() ctx: ReqCtx, @Body() body: unknown) {
    const input = parse(inviteSchema, body);
    return this.staff.invite(ctx, { ...input, phone: input.phone ?? null, email: input.email ?? null });
  }

  @Permission('staff.invite')
  @Post('invitations/:id/revoke')
  @HttpCode(200)
  async revoke(@Ctx() ctx: ReqCtx, @Param('id') id: string) {
    await this.staff.revokeInvitation(ctx, parseId(id));
    return { ok: true };
  }

  @Permission('staff.invite')
  @Post('invitations/:id/reissue')
  @HttpCode(200)
  reissue(@Ctx() ctx: ReqCtx, @Param('id') id: string) {
    return this.staff.reissueInvitation(ctx, parseId(id));
  }

  @Permission('staff.manage')
  @Put('staff/:membershipId')
  async update(@Ctx() ctx: ReqCtx, @Param('membershipId') membershipId: string, @Body() body: unknown) {
    await this.staff.updateAccess(ctx, parseId(membershipId), parse(accessSchema, body));
    return { ok: true };
  }

  @Permission('staff.manage')
  @Post('staff/:membershipId/deactivate')
  @HttpCode(200)
  async deactivate(@Ctx() ctx: ReqCtx, @Param('membershipId') membershipId: string) {
    await this.staff.deactivate(ctx, parseId(membershipId));
    return { ok: true };
  }

  @Permission('staff.manage')
  @Post('staff/:membershipId/reactivate')
  @HttpCode(200)
  async reactivate(@Ctx() ctx: ReqCtx, @Param('membershipId') membershipId: string) {
    await this.staff.reactivate(ctx, parseId(membershipId));
    return { ok: true };
  }

  @Permission('staff.reset_password')
  @Post('staff/:membershipId/reset-password')
  @HttpCode(200)
  reset(@Ctx() ctx: ReqCtx, @Param('membershipId') membershipId: string) {
    return this.staff.resetPassword(ctx, parseId(membershipId));
  }
}
