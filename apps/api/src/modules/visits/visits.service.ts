import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit.service';
import { AppError, badRequest, forbidden, notFound } from '../../common/errors';
import type { ReqCtx } from '../../common/request-context';
import { CONFIG, type AppConfig } from '../../config/config';
import { DbService } from '../../db/db.service';
import { buildSet } from '../../db/sql';
import type { Tx } from '../../db/tx';
import { AiService } from '../ai/ai.service';
import type { HandwritingResult, ImageMime, StructuredNote } from '../ai/ai.types';
import { FILE_STORAGE, type FileStorage, detectImageType } from '../files/file-storage';
import { VisitAccess } from './visit-access';
import {
  type AttachmentFile,
  type AttachmentRecord,
  type VisitRecord,
  type VisitSummary,
  VisitsRepository,
} from './visits.repository';
import type { CreateVisit, UpdateVisit } from './visits.schemas';

const MAX_ATTACHMENTS_PER_VISIT = 10;

export interface VisitDetail {
  visit: VisitRecord;
  attachments: AttachmentRecord[];
}

export type AiOutcome =
  | { status: 'transcribed'; uncertainWords: string[]; language: HandwritingResult['language'] }
  | { status: 'skipped'; code: string; message: string }
  | { status: 'failed'; code: string; message: string };

export interface UploadResult {
  attachment: AttachmentRecord;
  ai: AiOutcome;
}

@Injectable()
export class VisitsService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(VisitsRepository) private readonly repo: VisitsRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AiService) private readonly ai: AiService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(VisitAccess) private readonly access: VisitAccess,
  ) {}

  async create(ctx: ReqCtx, input: CreateVisit): Promise<VisitDetail> {
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const doctorId = await this.resolveDoctorId(tx, ctx, input.doctorId);
      if (!(await this.repo.patientExists(tx, input.patientId))) throw notFound('This patient');
      if (input.appointmentId !== undefined) {
        const appointment = await this.repo.appointmentFor(tx, input.appointmentId);
        if (appointment === null) throw notFound('This appointment');
        if (appointment.patientId !== input.patientId || appointment.doctorId !== doctorId) {
          throw badRequest('appointment_mismatch', 'This appointment belongs to a different patient or doctor.');
        }
      }
      const id = await this.repo.insert(tx, {
        clinicId: ctx.user.clinicId,
        patientId: input.patientId,
        doctorId,
        appointmentId: input.appointmentId ?? null,
        complaint: input.complaint ?? null,
        history: input.history ?? null,
        examination: input.examination ?? null,
        diagnosis: input.diagnosis ?? null,
        plan: input.plan ?? null,
        vitals: input.vitals ?? {},
        inputSource: input.inputSource,
        aiAssisted: input.aiAssisted,
        createdBy: ctx.user.id,
      });
      await this.audit.record(tx, ctx, {
        action: 'visit.created',
        entity: 'visit',
        entityId: id,
        meta: { source: input.inputSource, aiAssisted: input.aiAssisted },
      });
      return this.detail(tx, id);
    });
  }

  /** Opening clinical notes is logged, because they are the most sensitive records in the system. */
  async get(ctx: ReqCtx, id: string): Promise<VisitDetail> {
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const detail = await this.detail(tx, id);
      await this.audit.record(tx, ctx, { action: 'visit.viewed', entity: 'visit', entityId: id });
      return detail;
    });
  }

  listForPatient(ctx: ReqCtx, patientId: string, limit: number, offset: number): Promise<{ items: VisitSummary[]; total: number }> {
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      if (!(await this.repo.patientExists(tx, patientId))) throw notFound('This patient');
      return this.repo.listForPatient(tx, patientId, limit, offset);
    });
  }

  async update(ctx: ReqCtx, id: string, patch: UpdateVisit): Promise<VisitDetail> {
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const current = await this.repo.lockById(tx, id);
      if (current === null) throw notFound('This visit');
      await this.access.assertMayEdit(tx, ctx, current.doctorId);
      const set = buildSet(
        {
          complaint: patch.complaint,
          history: patch.history,
          examination: patch.examination,
          diagnosis: patch.diagnosis,
          plan: patch.plan,
          vitals: patch.vitals === undefined ? undefined : JSON.stringify(patch.vitals),
          input_source: patch.inputSource,
          ai_assisted: patch.aiAssisted,
        },
        2,
      );
      if (set !== null) {
        await tx.execute(`update visits set ${set.sql} where id = $1`, [id, ...set.values]);
        await this.audit.record(tx, ctx, {
          action: 'visit.updated',
          entity: 'visit',
          entityId: id,
          meta: { fields: Object.keys(patch).join(',') },
        });
      }
      return this.detail(tx, id);
    });
  }

  /** Suggests how to split a dictated note into fields. Nothing is saved. */
  structureNote(ctx: ReqCtx, text: string): Promise<StructuredNote> {
    return this.ai.structureNote(ctx, text);
  }

  async uploadHandwriting(ctx: ReqCtx, visitId: string, file: { buffer: Buffer; size: number } | undefined): Promise<UploadResult> {
    if (file === undefined || file.size === 0) {
      throw badRequest('image_required', 'Choose a photo of the handwritten note.');
    }
    if (file.size > this.config.uploadMaxBytes) {
      throw new AppError(413, 'payload_too_large', 'The photo is too large. Take it again at a lower quality.');
    }
    const mime = detectImageType(file.buffer);
    if (mime === null) throw badRequest('unsupported_image', 'Use a JPEG, PNG or WebP photo.');

    const attachment = await this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const visit = await this.repo.lockById(tx, visitId);
      if (visit === null) throw notFound('This visit');
      await this.access.assertMayEdit(tx, ctx, visit.doctorId);
      if ((await this.repo.attachmentCount(tx, visitId)) >= MAX_ATTACHMENTS_PER_VISIT) {
        throw badRequest('too_many_attachments', `A visit can hold up to ${MAX_ATTACHMENTS_PER_VISIT} photos.`);
      }
      const storageKey = await this.storage.save(ctx.user.clinicId, file.buffer, mime);
      try {
        const saved = await this.repo.insertAttachment(tx, {
          clinicId: ctx.user.clinicId,
          visitId,
          mimeType: mime,
          sizeBytes: file.size,
          storageKey,
          sha256: createHash('sha256').update(file.buffer).digest('hex'),
          createdBy: ctx.user.id,
        });
        await this.audit.record(tx, ctx, {
          action: 'visit.handwriting_uploaded',
          entity: 'visit',
          entityId: visitId,
          meta: { bytes: file.size },
        });
        return saved;
      } catch (error) {
        // The database write failed, so do not leave an orphan file behind.
        await this.storage.remove(storageKey);
        throw error;
      }
    });

    return this.transcribeUploaded(ctx, attachment, { data: file.buffer, mime });
  }

  /** Reads a stored photo again, for example after the AI service was down at upload time. */
  async retranscribe(ctx: ReqCtx, visitId: string, attachmentId: string): Promise<UploadResult> {
    const file = await this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const visit = await this.repo.lockById(tx, visitId);
      if (visit === null) throw notFound('This visit');
      await this.access.assertMayEdit(tx, ctx, visit.doctorId);
      const found = await this.repo.attachmentFile(tx, visitId, attachmentId);
      if (found === null) throw notFound('This photo');
      return found;
    });
    const data = await this.storage.read(file.storageKey);
    return this.transcribeUploaded(ctx, file, { data, mime: file.mimeType });
  }

  async editTranscription(ctx: ReqCtx, visitId: string, attachmentId: string, transcription: string): Promise<AttachmentRecord> {
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const visit = await this.repo.lockById(tx, visitId);
      if (visit === null) throw notFound('This visit');
      await this.access.assertMayEdit(tx, ctx, visit.doctorId);
      const found = await this.repo.attachmentFile(tx, visitId, attachmentId);
      if (found === null) throw notFound('This photo');
      const updated = await this.repo.setTranscription(tx, attachmentId, transcription, false);
      await this.audit.record(tx, ctx, {
        action: 'visit.transcription_edited',
        entity: 'visit',
        entityId: visitId,
        meta: { characters: transcription.length },
      });
      return updated;
    });
  }

  /** The photo itself, for display. Only people who may read clinical notes can fetch it. */
  async readImage(ctx: ReqCtx, visitId: string, attachmentId: string): Promise<{ data: Buffer; mime: ImageMime }> {
    const file = await this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const found = await this.repo.attachmentFile(tx, visitId, attachmentId);
      if (found === null) throw notFound('This photo');
      await this.audit.record(tx, ctx, { action: 'visit.photo_viewed', entity: 'visit', entityId: visitId });
      return found;
    });
    return { data: await this.storage.read(file.storageKey), mime: file.mimeType };
  }

  /** Runs after the upload is saved, outside any transaction, because the AI call can take seconds. */
  private async transcribeUploaded(
    ctx: ReqCtx,
    attachment: AttachmentRecord,
    image: { data: Buffer; mime: ImageMime },
  ): Promise<UploadResult> {
    if (!this.ai.configured) {
      return {
        attachment,
        ai: { status: 'skipped', code: 'ai_not_configured', message: 'AI reading is not set up on this server. Type the note instead.' },
      };
    }
    if (!(await this.ai.isEnabledFor(ctx.user.clinicId))) {
      return {
        attachment,
        ai: {
          status: 'skipped',
          code: 'ai_not_enabled',
          message: 'AI reading is off. Type the note, or ask the owner to turn on AI features.',
        },
      };
    }
    try {
      const result = await this.ai.transcribeHandwriting(ctx, image);
      const saved = await this.db.withClinic(ctx.user.clinicId, (tx) =>
        this.repo.setTranscription(tx, attachment.id, result.text, true),
      );
      return { attachment: saved, ai: { status: 'transcribed', uncertainWords: result.uncertainWords, language: result.language } };
    } catch (error) {
      if (error instanceof AppError) {
        return { attachment, ai: { status: 'failed', code: error.code, message: error.message } };
      }
      throw error;
    }
  }

  private async detail(tx: Tx, id: string): Promise<VisitDetail> {
    const visit = await this.repo.byId(tx, id);
    if (visit === null) throw notFound('This visit');
    return { visit, attachments: await this.repo.attachmentsFor(tx, id) };
  }

  private async resolveDoctorId(tx: Tx, ctx: ReqCtx, requested: string | undefined): Promise<string> {
    if (ctx.user.role === 'doctor') {
      const mine = await this.repo.doctorProfileForUser(tx, ctx.user.id);
      if (mine === null || !mine.active) {
        throw badRequest('no_doctor_profile', 'Your account has no active doctor profile. Ask the owner to set one up.');
      }
      if (requested !== undefined && requested !== mine.id) {
        throw forbidden('You can only record visits for yourself.');
      }
      return mine.id;
    }
    if (requested === undefined) throw badRequest('doctor_required', 'Choose which doctor saw the patient.');
    const doctor = await this.repo.doctorExists(tx, requested);
    if (doctor === null) throw notFound('This doctor');
    return doctor.id;
  }
}

export type { AttachmentFile };
