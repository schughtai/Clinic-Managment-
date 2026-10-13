import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { Roles } from '../../common/access';
import { Ctx, type ReqCtx } from '../../common/request-context';
import { StrictRate } from '../../common/throttling';
import { parse, parseId } from '../../common/validate';
import type { StructuredNote } from '../ai/ai.types';
import type { AttachmentRecord, VisitSummary } from './visits.repository';
import {
  createVisitSchema,
  listVisitsSchema,
  structureNoteSchema,
  transcriptionEditSchema,
  updateVisitSchema,
} from './visits.schemas';
import { type UploadResult, type VisitDetail, VisitsService } from './visits.service';

/** The hard ceiling for a single upload. The configured limit, which may be lower, is checked in the service. */
const UPLOAD_CEILING_BYTES = 5_000_000;

const photoUpload = FileInterceptor('image', {
  storage: memoryStorage(),
  limits: { fileSize: UPLOAD_CEILING_BYTES, files: 1, fields: 2 },
});

/** Clinical notes are for the clinical team. Receptionists have no access to anything here. */
@Roles('owner', 'doctor')
@Controller()
export class VisitsController {
  constructor(@Inject(VisitsService) private readonly visits: VisitsService) {}

  @Post('visits')
  create(@Ctx() ctx: ReqCtx, @Body() body: unknown): Promise<VisitDetail> {
    return this.visits.create(ctx, parse(createVisitSchema, body));
  }

  @Get('patients/:patientId/visits')
  listForPatient(
    @Ctx() ctx: ReqCtx,
    @Param('patientId') patientId: string,
    @Query() query: unknown,
  ): Promise<{ items: VisitSummary[]; total: number }> {
    const page = parse(listVisitsSchema, query);
    return this.visits.listForPatient(ctx, parseId(patientId), page.limit, page.offset);
  }

  @StrictRate()
  @Post('visits/ai/structure')
  structure(@Ctx() ctx: ReqCtx, @Body() body: unknown): Promise<StructuredNote> {
    return this.visits.structureNote(ctx, parse(structureNoteSchema, body).text);
  }

  @Get('visits/:id')
  get(@Ctx() ctx: ReqCtx, @Param('id') id: string): Promise<VisitDetail> {
    return this.visits.get(ctx, parseId(id));
  }

  @Patch('visits/:id')
  update(@Ctx() ctx: ReqCtx, @Param('id') id: string, @Body() body: unknown): Promise<VisitDetail> {
    return this.visits.update(ctx, parseId(id), parse(updateVisitSchema, body));
  }

  @StrictRate()
  @Post('visits/:id/handwriting')
  @UseInterceptors(photoUpload)
  uploadHandwriting(
    @Ctx() ctx: ReqCtx,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<UploadResult> {
    return this.visits.uploadHandwriting(ctx, parseId(id), file);
  }

  @StrictRate()
  @Post('visits/:id/attachments/:attachmentId/transcribe')
  retranscribe(
    @Ctx() ctx: ReqCtx,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ): Promise<UploadResult> {
    return this.visits.retranscribe(ctx, parseId(id), parseId(attachmentId));
  }

  @Patch('visits/:id/attachments/:attachmentId')
  editTranscription(
    @Ctx() ctx: ReqCtx,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Body() body: unknown,
  ): Promise<AttachmentRecord> {
    return this.visits.editTranscription(ctx, parseId(id), parseId(attachmentId), parse(transcriptionEditSchema, body).transcription);
  }

  @Get('visits/:id/attachments/:attachmentId/image')
  async image(
    @Ctx() ctx: ReqCtx,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.visits.readImage(ctx, parseId(id), parseId(attachmentId));
    response.setHeader('Content-Type', file.mime);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    response.send(file.data);
  }
}
