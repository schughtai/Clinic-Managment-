import { Body, Controller, Get, Inject, Patch } from '@nestjs/common';
import { Roles } from '../../common/access';
import { Ctx, type ReqCtx } from '../../common/request-context';
import { parse } from '../../common/validate';
import { type ClinicSettings, ClinicService, updateClinicSchema } from './clinic.service';

@Controller('clinic')
export class ClinicController {
  constructor(@Inject(ClinicService) private readonly clinic: ClinicService) {}

  @Roles('owner', 'doctor', 'receptionist')
  @Get()
  get(@Ctx() ctx: ReqCtx): Promise<ClinicSettings> {
    return this.clinic.get(ctx);
  }

  @Roles('owner')
  @Patch()
  update(@Ctx() ctx: ReqCtx, @Body() body: unknown): Promise<ClinicSettings> {
    return this.clinic.update(ctx, parse(updateClinicSchema, body));
  }
}
