import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../../common/access';
import { Ctx, type ReqCtx } from '../../common/request-context';
import { parse, parseId } from '../../common/validate';
import {
  type StaffUser,
  UsersService,
  createUserSchema,
  resetPasswordSchema,
  updateUserSchema,
} from './users.service';

@Roles('owner')
@Controller('users')
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get()
  list(@Ctx() ctx: ReqCtx): Promise<StaffUser[]> {
    return this.users.list(ctx);
  }

  @Post()
  create(@Ctx() ctx: ReqCtx, @Body() body: unknown): Promise<StaffUser> {
    return this.users.create(ctx, parse(createUserSchema, body));
  }

  @Patch(':id')
  update(@Ctx() ctx: ReqCtx, @Param('id') id: string, @Body() body: unknown): Promise<StaffUser> {
    return this.users.update(ctx, parseId(id), parse(updateUserSchema, body));
  }

  @Post(':id/reset-password')
  @HttpCode(204)
  async resetPassword(@Ctx() ctx: ReqCtx, @Param('id') id: string, @Body() body: unknown): Promise<void> {
    await this.users.resetPassword(ctx, parseId(id), parse(resetPasswordSchema, body).newPassword);
  }
}
