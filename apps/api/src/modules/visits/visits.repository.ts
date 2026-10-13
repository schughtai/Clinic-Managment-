import { Injectable } from '@nestjs/common';
import type { Tx } from '../../db/tx';
import type { Vitals } from './visits.schemas';

export interface VisitRecord {
  id: string;
  patientId: string;
  doctorId: string;
  doctorName: string;
  appointmentId: string | null;
  visitedAt: Date;
  complaint: string | null;
  history: string | null;
  examination: string | null;
  diagnosis: string | null;
  plan: string | null;
  vitals: Vitals;
  inputSource: 'typed' | 'voice' | 'handwriting' | 'mixed';
  aiAssisted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface VisitSummary {
  id: string;
  visitedAt: Date;
  doctorName: string;
  complaint: string | null;
  diagnosis: string | null;
  inputSource: VisitRecord['inputSource'];
  hasPrescription: boolean;
  attachmentCount: number;
}

export interface AttachmentRecord {
  id: string;
  visitId: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  sizeBytes: number;
  transcription: string | null;
  aiTranscribed: boolean;
  createdAt: Date;
}

export interface AttachmentFile extends AttachmentRecord {
  storageKey: string;
}

const VISIT_SELECT = `
  select v.id, v.patient_id as "patientId", v.doctor_id as "doctorId", d.name as "doctorName",
         v.appointment_id as "appointmentId", v.visited_at as "visitedAt",
         v.complaint, v.history, v.examination, v.diagnosis, v.plan, v.vitals,
         v.input_source as "inputSource", v.ai_assisted as "aiAssisted",
         v.created_at as "createdAt", v.updated_at as "updatedAt"
    from visits v join doctors d on d.id = v.doctor_id`;

const ATTACHMENT_COLUMNS = `
  id, visit_id as "visitId", mime_type as "mimeType", size_bytes as "sizeBytes",
  transcription, ai_transcribed as "aiTranscribed", created_at as "createdAt"`;

export interface NewVisit {
  clinicId: string;
  patientId: string;
  doctorId: string;
  appointmentId: string | null;
  complaint: string | null;
  history: string | null;
  examination: string | null;
  diagnosis: string | null;
  plan: string | null;
  vitals: Vitals;
  inputSource: string;
  aiAssisted: boolean;
  createdBy: string;
}

@Injectable()
export class VisitsRepository {
  /** The doctor profile that belongs to a signed-in user, if they have one. */
  doctorProfileForUser(tx: Tx, userId: string): Promise<{ id: string; active: boolean } | null> {
    return tx.maybeOne('select id, active from doctors where user_id = $1', [userId]);
  }

  doctorExists(tx: Tx, doctorId: string): Promise<{ id: string; active: boolean } | null> {
    return tx.maybeOne('select id, active from doctors where id = $1', [doctorId]);
  }

  patientExists(tx: Tx, patientId: string): Promise<boolean> {
    return tx.maybeOne<{ id: string }>('select id from patients where id = $1', [patientId]).then((row) => row !== null);
  }

  appointmentFor(tx: Tx, appointmentId: string): Promise<{ patientId: string; doctorId: string } | null> {
    return tx.maybeOne('select patient_id as "patientId", doctor_id as "doctorId" from appointments where id = $1', [
      appointmentId,
    ]);
  }

  async insert(tx: Tx, visit: NewVisit): Promise<string> {
    const row = await tx.one<{ id: string }>(
      `insert into visits (clinic_id, patient_id, doctor_id, appointment_id, complaint, history, examination,
                           diagnosis, plan, vitals, input_source, ai_assisted, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13) returning id`,
      [
        visit.clinicId,
        visit.patientId,
        visit.doctorId,
        visit.appointmentId,
        visit.complaint,
        visit.history,
        visit.examination,
        visit.diagnosis,
        visit.plan,
        JSON.stringify(visit.vitals),
        visit.inputSource,
        visit.aiAssisted,
        visit.createdBy,
      ],
    );
    return row.id;
  }

  byId(tx: Tx, id: string): Promise<VisitRecord | null> {
    return tx.maybeOne<VisitRecord>(`${VISIT_SELECT} where v.id = $1`, [id]);
  }

  /** Locks the visit while it is being changed, so two edits cannot overwrite each other silently. */
  lockById(tx: Tx, id: string): Promise<{ id: string; doctorId: string; patientId: string } | null> {
    return tx.maybeOne(
      'select id, doctor_id as "doctorId", patient_id as "patientId" from visits where id = $1 for update',
      [id],
    );
  }

  async listForPatient(tx: Tx, patientId: string, limit: number, offset: number): Promise<{ items: VisitSummary[]; total: number }> {
    const items = await tx.many<VisitSummary>(
      `select v.id, v.visited_at as "visitedAt", d.name as "doctorName",
              left(v.complaint, 200) as complaint, left(v.diagnosis, 200) as diagnosis,
              v.input_source as "inputSource",
              exists (select 1 from prescriptions p where p.visit_id = v.id) as "hasPrescription",
              (select count(*)::int from visit_attachments a where a.visit_id = v.id) as "attachmentCount"
         from visits v join doctors d on d.id = v.doctor_id
        where v.patient_id = $1
        order by v.visited_at desc, v.id
        limit $2 offset $3`,
      [patientId, limit, offset],
    );
    const count = await tx.one<{ total: number }>('select count(*)::int as total from visits where patient_id = $1', [patientId]);
    return { items, total: count.total };
  }

  attachmentsFor(tx: Tx, visitId: string): Promise<AttachmentRecord[]> {
    return tx.many<AttachmentRecord>(
      `select ${ATTACHMENT_COLUMNS} from visit_attachments where visit_id = $1 order by created_at, id`,
      [visitId],
    );
  }

  async attachmentCount(tx: Tx, visitId: string): Promise<number> {
    const row = await tx.one<{ count: number }>('select count(*)::int as count from visit_attachments where visit_id = $1', [visitId]);
    return row.count;
  }

  insertAttachment(
    tx: Tx,
    input: { clinicId: string; visitId: string; mimeType: string; sizeBytes: number; storageKey: string; sha256: string; createdBy: string },
  ): Promise<AttachmentRecord> {
    return tx.one<AttachmentRecord>(
      `insert into visit_attachments (clinic_id, visit_id, kind, mime_type, size_bytes, storage_key, sha256, created_by)
       values ($1, $2, 'handwriting', $3, $4, $5, $6, $7)
       returning ${ATTACHMENT_COLUMNS}`,
      [input.clinicId, input.visitId, input.mimeType, input.sizeBytes, input.storageKey, input.sha256, input.createdBy],
    );
  }

  attachmentFile(tx: Tx, visitId: string, attachmentId: string): Promise<AttachmentFile | null> {
    return tx.maybeOne<AttachmentFile>(
      `select ${ATTACHMENT_COLUMNS}, storage_key as "storageKey"
         from visit_attachments where id = $1 and visit_id = $2`,
      [attachmentId, visitId],
    );
  }

  setTranscription(tx: Tx, attachmentId: string, transcription: string, aiTranscribed: boolean): Promise<AttachmentRecord> {
    return tx.one<AttachmentRecord>(
      `update visit_attachments set transcription = $2, ai_transcribed = ai_transcribed or $3
        where id = $1 returning ${ATTACHMENT_COLUMNS}`,
      [attachmentId, transcription, aiTranscribed],
    );
  }

  async aiEnabled(tx: Tx): Promise<boolean> {
    const row = await tx.one<{ aiEnabled: boolean }>('select ai_enabled as "aiEnabled" from clinics limit 1');
    return row.aiEnabled;
  }
}
