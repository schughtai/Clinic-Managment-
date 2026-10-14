import { Controller, Get, Inject, Post, Query, Res, UploadedFile, UseInterceptors, Body } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import { Roles } from '../../common/access';
import { badRequest } from '../../common/errors';
import { Ctx, type ReqCtx } from '../../common/request-context';
import { StrictRate } from '../../common/throttling';
import { parse } from '../../common/validate';
import { type AuditEntry, ExportService, auditQuerySchema } from './export.service';
import { type ImportResult, ImportService } from './import.service';

const csvUpload = FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: 1_000_000, files: 1, fields: 4 },
});

const importFieldsSchema = z.object({ dryRun: z.enum(['true', 'false']).default('true') }).strict();

@Controller()
export class DataController {
  constructor(
    @Inject(ImportService) private readonly imports: ImportService,
    @Inject(ExportService) private readonly exports: ExportService,
  ) {}

  /** Defaults to a dry run, so a file is checked before anything is written. */
  @Roles('owner', 'receptionist')
  @StrictRate()
  @Post('patients/import')
  @UseInterceptors(csvUpload)
  importPatients(
    @Ctx() ctx: ReqCtx,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: unknown,
  ): Promise<ImportResult> {
    if (file === undefined || file.size === 0) throw badRequest('file_required', 'Choose a CSV file.');
    const fields = parse(importFieldsSchema, body ?? {});
    return this.imports.importPatients(ctx, file.buffer.toString('utf8'), fields.dryRun === 'true');
  }

  @Roles('owner')
  @StrictRate()
  @Get('export')
  async exportAll(@Ctx() ctx: ReqCtx, @Res() response: Response): Promise<void> {
    const data = await this.exports.exportAll(ctx);
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="clinic-export-${new Date().toISOString().slice(0, 10)}.json"`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(JSON.stringify(data));
  }

  @Roles('owner')
  @Get('audit')
  audit(@Ctx() ctx: ReqCtx, @Query() query: unknown): Promise<{ items: AuditEntry[]; total: number }> {
    return this.exports.listAudit(ctx, parse(auditQuerySchema, query));
  }
}
