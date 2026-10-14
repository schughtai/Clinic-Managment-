import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit.service';
import { conflict, notFound } from '../../common/errors';
import { normalizePhone } from '../../common/phone';
import { orgOf, type ReqCtx } from '../../common/request-context';
import { DbService } from '../../db/db.service';
import type { Tx } from '../../db/tx';
import { orgDb } from '../identity/access.guard';
import { nameSearchTokens, patientNameKey, patientNameWords } from './name-search';

export const PHONE_LABELS = ['mobile', 'home', 'emergency', 'other'] as const;
export const SEXES = ['female', 'male', 'other', 'unknown'] as const;

export type PhoneLabel = (typeof PHONE_LABELS)[number];
export type Sex = (typeof SEXES)[number];

export interface PatientInput {
  nameEn?: string;
  nameUr?: string;
  sex: Sex;
  dateOfBirth?: string;
  approximateAge?: number;
  address?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  phones: { phone: string; label: PhoneLabel }[];
  confirmDuplicates: boolean;
}

export interface PatientPatch {
  nameEn?: string;
  nameUr?: string;
  sex?: Sex;
  dateOfBirth?: string;
  approximateAge?: number;
  address?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
}

/** Database column for each editable field, so an update changes only what was sent. */
const COLUMNS: Record<keyof PatientPatch, string> = {
  nameEn: 'name_en',
  nameUr: 'name_ur',
  sex: 'sex',
  dateOfBirth: 'date_of_birth',
  approximateAge: 'approximate_age',
  address: 'address',
  emergencyContactName: 'emergency_contact_name',
  emergencyContactPhone: 'emergency_contact_phone',
};

/** Columns returned to the screens. Dates are plain YYYY-MM-DD strings, never timestamps. */
const SUMMARY_COLUMNS = `
  p.id,
  p.patient_number as "patientNumber",
  p.name_en as "nameEn",
  p.name_ur as "nameUr",
  p.sex,
  to_char(p.date_of_birth, 'YYYY-MM-DD') as "dateOfBirth",
  p.approximate_age as "approximateAge",
  p.address,
  p.emergency_contact_name as "emergencyContactName",
  p.emergency_contact_phone as "emergencyContactPhone",
  p.created_at as "createdAt"`;

export interface DuplicateCandidate {
  id: string;
  patientNumber: string;
  name: string | null;
  reason: 'phone' | 'name';
}

/**
 * Patients, their numbers, phones and duplicate checks. Patients belong to the whole organization,
 * so every branch sees the same patient; the database row-level security keeps other organizations out.
 */
@Injectable()
export class PatientsService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Finds patients by number, phone or name. */
  async search(ctx: ReqCtx, query: string) {
    const q = query.trim();
    return this.db.withContext(orgDb(ctx), async (tx) => {
      const phone = q.length >= 6 ? normalizePhone(q) : null;
      if (phone !== null) {
        return tx.many(
          `select ${SUMMARY_COLUMNS} from patients p
           where p.merged_into is null and (p.patient_number = $1 or exists (
             select 1 from patient_phones ph where ph.patient_id = p.id and ph.phone = $2))
           order by p.patient_number limit 50`,
          [q.toUpperCase(), phone],
        );
      }
      if (q === '') return [];
      // A number such as P-000001 also reads as a name, so the number is always checked too.
      const tokens = nameSearchTokens(q);
      const clauses = tokens.map((_, index) => `p.name_key like '%' || $${index + 2} || '%'`);
      const match = clauses.length > 0 ? `(p.patient_number = $1 or (${clauses.join(' and ')}))` : 'p.patient_number = $1';
      return tx.many(
        `select ${SUMMARY_COLUMNS} from patients p
         where p.merged_into is null and ${match}
         order by p.created_at desc limit 50`,
        [q.toUpperCase(), ...tokens],
      );
    });
  }

  async get(ctx: ReqCtx, id: string) {
    return this.db.withContext(orgDb(ctx), async (tx) => {
      const patient = await this.load(tx, id);
      const phones = await tx.many<{ phone: string; label: string }>(
        'select phone, label from patient_phones where patient_id = $1 order by label, phone',
        [id],
      );
      return { ...patient, phones };
    });
  }

  /** Creates a patient. Likely duplicates stop the save with 409 until the receptionist confirms. */
  async create(ctx: ReqCtx, input: PatientInput) {
    const organizationId = orgOf(ctx).id;
    return this.db.withContext(orgDb(ctx), async (tx) => {
      const key = patientNameKey(input.nameEn, input.nameUr);
      const duplicates = await this.findDuplicates(tx, key, input.phones.map((p) => p.phone));
      if (duplicates.length > 0 && !input.confirmDuplicates) {
        throw conflict('possible_duplicates', 'A patient with a similar name or phone number already exists.', { duplicates });
      }
      const number = await this.nextPatientNumber(tx, organizationId);
      const created = await tx.one<{ id: string }>(
        `insert into patients (organization_id, patient_number, name_en, name_ur, name_key, name_words, sex,
           date_of_birth, approximate_age, address, emergency_contact_name, emergency_contact_phone, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         returning id`,
        [
          organizationId,
          number,
          input.nameEn ?? null,
          input.nameUr ?? null,
          key,
          patientNameWords(input.nameEn, input.nameUr),
          input.sex,
          input.dateOfBirth ?? null,
          input.approximateAge ?? null,
          input.address ?? null,
          input.emergencyContactName ?? null,
          input.emergencyContactPhone ?? null,
          ctx.person.id,
        ],
      );
      for (const phone of input.phones) {
        await tx.execute('insert into patient_phones (organization_id, patient_id, phone, label) values ($1, $2, $3, $4)', [
          organizationId,
          created.id,
          phone.phone,
          phone.label,
        ]);
      }
      await this.audit.org(tx, ctx, 'patient.created', { type: 'patient', id: created.id });
      return { id: created.id, patientNumber: number };
    });
  }

  /** Changes only the fields sent. The audit entry names the fields that changed, never their values. */
  async update(ctx: ReqCtx, id: string, patch: PatientPatch) {
    return this.db.withContext(orgDb(ctx), async (tx) => {
      const before = await this.load(tx, id);
      const changes: [string, unknown][] = [];
      const fields = (Object.keys(patch) as (keyof PatientPatch)[]).filter((field) => patch[field] !== undefined);
      for (const field of fields) changes.push([COLUMNS[field], patch[field]]);
      if (changes.length === 0) return { changed: [] as string[] };

      // A patient has a date of birth or an approximate age, never both.
      if (patch.dateOfBirth !== undefined) changes.push(['approximate_age', null]);
      if (patch.approximateAge !== undefined) changes.push(['date_of_birth', null]);

      if (patch.nameEn !== undefined || patch.nameUr !== undefined) {
        const nameEn = patch.nameEn ?? before.nameEn ?? undefined;
        const nameUr = patch.nameUr ?? before.nameUr ?? undefined;
        changes.push(['name_key', patientNameKey(nameEn, nameUr)]);
        changes.push(['name_words', patientNameWords(nameEn, nameUr)]);
      }

      const assignments = changes.map(([column], index) => `${column} = $${index + 1}`).join(', ');
      await tx.execute(`update patients set ${assignments} where id = $${changes.length + 1}`, [
        ...changes.map(([, value]) => value),
        id,
      ]);
      await this.audit.org(tx, ctx, 'patient.updated', { type: 'patient', id }, { fields: fields.join(',') });
      return { changed: fields as string[] };
    });
  }

  async addPhone(ctx: ReqCtx, id: string, phone: string, label: PhoneLabel) {
    return this.db.withContext(orgDb(ctx), async (tx) => {
      await this.load(tx, id);
      await tx.execute('insert into patient_phones (organization_id, patient_id, phone, label) values ($1, $2, $3, $4)', [
        orgOf(ctx).id,
        id,
        phone,
        label,
      ]);
      await this.audit.org(tx, ctx, 'patient.phone_added', { type: 'patient', id });
      return { ok: true };
    });
  }

  private async load(tx: Tx, id: string): Promise<{ id: string; nameEn: string | null; nameUr: string | null } & Record<string, unknown>> {
    const row = await tx.maybeOne<{ id: string; nameEn: string | null; nameUr: string | null } & Record<string, unknown>>(
      `select ${SUMMARY_COLUMNS} from patients p where p.id = $1 and p.merged_into is null`,
      [id],
    );
    if (row === null) throw notFound('Patient');
    return row;
  }

  /** Patients with the same phone number, or a very similar name. */
  private async findDuplicates(tx: Tx, key: string, phones: string[]): Promise<DuplicateCandidate[]> {
    const byPhone =
      phones.length === 0
        ? []
        : await tx.many<DuplicateCandidate>(
            `select distinct p.id, p.patient_number as "patientNumber",
               coalesce(p.name_en, p.name_ur) as name, 'phone' as reason
             from patient_phones ph join patients p on p.id = ph.patient_id
             where ph.phone = any($1::text[]) and p.merged_into is null
             limit 10`,
            [phones],
          );
    const byName = await tx.many<DuplicateCandidate>(
      `select p.id, p.patient_number as "patientNumber", coalesce(p.name_en, p.name_ur) as name, 'name' as reason
       from patients p
       where p.merged_into is null and similarity(p.name_key, $1) >= 0.6
       order by similarity(p.name_key, $1) desc
       limit 10`,
      [key],
    );
    const seen = new Set<string>();
    return [...byPhone, ...byName].filter((candidate) => {
      if (seen.has(candidate.id)) return false;
      seen.add(candidate.id);
      return true;
    });
  }

  /**
   * The next patient number for the organization. The counter row is locked by the update until the
   * transaction ends, so two receptionists saving at the same moment get different numbers.
   */
  private async nextPatientNumber(tx: Tx, organizationId: string): Promise<string> {
    await tx.execute(
      'insert into organization_settings_billing (organization_id) values ($1) on conflict (organization_id) do nothing',
      [organizationId],
    );
    const counter = await tx.one<{ prefix: string; seq: string }>(
      `update organization_settings_billing
       set patient_seq = patient_seq + 1, patient_numbers_locked = true
       where organization_id = $1
       returning patient_prefix as prefix, patient_seq::text as seq`,
      [organizationId],
    );
    return `${counter.prefix}${counter.seq.padStart(6, '0')}`;
  }
}
