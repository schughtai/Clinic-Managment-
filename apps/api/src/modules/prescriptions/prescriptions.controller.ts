import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { Roles } from '../../common/access';
import { Ctx, type ReqCtx } from '../../common/request-context';
import { parse, parseId } from '../../common/validate';
import {
  type Prescription,
  type PrescriptionPrint,
  PrescriptionsService,
  type Template,
  savePrescriptionSchema,
  saveTemplateSchema,
} from './prescriptions.service';

@Controller()
export class PrescriptionsController {
  constructor(@Inject(PrescriptionsService) private readonly prescriptions: PrescriptionsService) {}

  @Roles('owner', 'doctor')
  @Put('visits/:visitId/prescription')
  save(@Ctx() ctx: ReqCtx, @Param('visitId') visitId: string, @Body() body: unknown): Promise<Prescription> {
    return this.prescriptions.save(ctx, parseId(visitId), parse(savePrescriptionSchema, body));
  }

  @Roles('owner', 'doctor')
  @Get('visits/:visitId/prescription')
  get(@Ctx() ctx: ReqCtx, @Param('visitId') visitId: string): Promise<Prescription> {
    return this.prescriptions.get(ctx, parseId(visitId));
  }

  /** The printed sheet. The reception desk may hand it to the patient, but sees no diagnosis on it. */
  @Roles('owner', 'doctor', 'receptionist')
  @Get('visits/:visitId/prescription/print')
  print(@Ctx() ctx: ReqCtx, @Param('visitId') visitId: string): Promise<PrescriptionPrint> {
    return this.prescriptions.forPrint(ctx, parseId(visitId));
  }

  @Roles('owner', 'doctor')
  @Get('prescription-templates')
  listTemplates(@Ctx() ctx: ReqCtx): Promise<Template[]> {
    return this.prescriptions.listTemplates(ctx);
  }

  @Roles('owner', 'doctor')
  @Post('prescription-templates')
  saveTemplate(@Ctx() ctx: ReqCtx, @Body() body: unknown): Promise<Template> {
    return this.prescriptions.saveTemplate(ctx, parse(saveTemplateSchema, body));
  }

  @Roles('owner', 'doctor')
  @Delete('prescription-templates/:id')
  @HttpCode(204)
  async deleteTemplate(@Ctx() ctx: ReqCtx, @Param('id') id: string): Promise<void> {
    await this.prescriptions.deleteTemplate(ctx, parseId(id));
  }
}
