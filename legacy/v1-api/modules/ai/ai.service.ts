import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'pino';
import { AuditService } from '../../common/audit.service';
import { AppError } from '../../common/errors';
import type { ReqCtx } from '../../common/request-context';
import { LOGGER } from '../../common/tokens';
import { DbService } from '../../db/db.service';
import {
  AI_PROVIDER,
  type AiProvider,
  AiError,
  type HandwritingResult,
  type ImageMime,
  type StructuredNote,
} from './ai.types';

/**
 * The gate in front of every AI call. It checks that the clinic switched the feature on and that the
 * server is set up for it, keeps the slow vendor call outside any database transaction, and turns
 * failures into clear messages. A failure never blocks saving a visit, because the doctor can type.
 */
@Injectable()
export class AiService {
  constructor(
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /** False when the server has no API key, whatever the clinic chose. */
  get configured(): boolean {
    return this.provider.available;
  }

  /** Whether AI could run for this clinic right now. Used to decide whether to even try. */
  async isEnabledFor(clinicId: string): Promise<boolean> {
    if (!this.provider.available) return false;
    return this.db.withClinic(clinicId, async (tx) => {
      const row = await tx.one<{ aiEnabled: boolean }>('select ai_enabled as "aiEnabled" from clinics limit 1');
      return row.aiEnabled;
    });
  }

  async transcribeHandwriting(ctx: ReqCtx, image: { data: Buffer; mime: ImageMime }): Promise<HandwritingResult> {
    await this.requireEnabled(ctx);
    try {
      const result = await this.provider.transcribeHandwriting(image);
      await this.record(ctx, 'ai.handwriting_transcribed', { ok: true, bytes: image.data.length });
      return result;
    } catch (error) {
      await this.record(ctx, 'ai.handwriting_transcribed', { ok: false, bytes: image.data.length });
      throw this.toAppError(error);
    }
  }

  async structureNote(ctx: ReqCtx, text: string): Promise<StructuredNote> {
    await this.requireEnabled(ctx);
    try {
      const result = await this.provider.structureNote(text);
      await this.record(ctx, 'ai.note_structured', { ok: true, characters: text.length });
      return result;
    } catch (error) {
      await this.record(ctx, 'ai.note_structured', { ok: false, characters: text.length });
      throw this.toAppError(error);
    }
  }

  private async requireEnabled(ctx: ReqCtx): Promise<void> {
    if (!this.provider.available) {
      throw new AppError(503, 'ai_not_configured', 'AI features are not set up on this server. Please type the note instead.');
    }
    if (!(await this.isEnabledFor(ctx.user.clinicId))) {
      throw new AppError(409, 'ai_not_enabled', 'AI features are switched off for this clinic. The owner can turn them on in settings.');
    }
  }

  /** Only counts and outcomes are recorded. The note text and the image are never written to the audit trail. */
  private record(ctx: ReqCtx, action: string, meta: Record<string, string | number | boolean>): Promise<void> {
    return this.db.withClinic(ctx.user.clinicId, (tx) => this.audit.record(tx, ctx, { action, meta }));
  }

  private toAppError(error: unknown): AppError {
    if (error instanceof AiError) {
      switch (error.kind) {
        case 'declined':
          return new AppError(422, 'ai_declined', error.message);
        case 'bad_output':
          return new AppError(502, 'ai_bad_output', 'The AI answer could not be used. Please try again or type the note.');
        case 'disabled':
          return new AppError(503, 'ai_not_configured', error.message);
        case 'unavailable':
          return new AppError(503, 'ai_unavailable', 'The AI service is not available right now. Please type the note instead.');
      }
    }
    this.logger.error({ err: error }, 'unexpected AI failure');
    return new AppError(503, 'ai_unavailable', 'The AI service is not available right now. Please type the note instead.');
  }
}
