import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { conflict, notFound } from '../../common/errors';
import { nameKey } from '../../common/name-key';
import type { ReqCtx } from '../../common/request-context';
import { nameSchema, phoneSchema } from '../../common/schemas';
import { nullableText, pageSchema } from '../../common/validate';
import { DbService } from '../../db/db.service';
import { buildSet } from '../../db/sql';
import {
  type PatientListItem,
  type PatientRecord,
  PatientsRepository,
} from './patients.repository';

const genderSchema = z.enum(['male', 'female', 'other']);

export const createPatientSchema = z
  .object({
    name: nameSchema,
    phone: phoneSchema.nullable().optional(),
    gender: genderSchema.nullable().optional(),
    /** Most patients know their age, not their birth date. It is stored as a birth year. */
    age: z.number().int().min(0).max(130).nullable().optional(),
    guardianName: nullableText(120),
    address: nullableText(300),
    allergies: nullableText(1000),
    notes: nullableText(2000),
    /** Set to true after the receptionist has seen the possible-duplicate warning. */
    confirmDuplicate: z.boolean().optional(),
  })
  .strict();

export const updatePatientSchema = createPatientSchema.omit({ confirmDuplicate: true }).partial().strict();

export const searchPatientsSchema = pageSchema.extend({ q: z.string().trim().max(100).optional() });

export type CreatePatient = z.output<typeof createPatientSchema>;
export type UpdatePatient = z.output<typeof updatePatientSchema>;

function birthYearFor(age: number | null | undefined): number | null | undefined {
  if (age === undefined) return undefined;
  if (age === null) return null;
  return new Date().getUTCFullYear() - age;
}

@Injectable()
export class PatientsService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(PatientsRepository) private readonly patients: PatientsRepository,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async create(ctx: ReqCtx, input: CreatePatient): Promise<PatientRecord> {
    const key = nameKey(input.name);
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      if (input.phone != null && input.confirmDuplicate !== true) {
        const duplicates = await this.patients.findDuplicates(tx, input.phone, key);
        if (duplicates.length > 0) {
          throw conflict(
            'possible_duplicate',
            'A patient with this name and phone number already exists.',
            { candidates: duplicates },
          );
        }
      }
      const patientNo = await this.patients.nextPatientNo(tx, ctx.user.clinicId);
      const created = await this.patients.insert(tx, {
        clinicId: ctx.user.clinicId,
        patientNo,
        name: input.name,
        nameKey: key,
        phone: input.phone ?? null,
        gender: input.gender ?? null,
        birthYear: birthYearFor(input.age) ?? null,
        guardianName: input.guardianName ?? null,
        address: input.address ?? null,
        allergies: input.allergies ?? null,
        notes: input.notes ?? null,
        createdBy: ctx.user.id,
      });
      await this.audit.record(tx, ctx, {
        action: 'patient.created',
        entity: 'patient',
        entityId: created.id,
        meta: { patientNo },
      });
      return created;
    });
  }

  search(
    ctx: ReqCtx,
    query: z.output<typeof searchPatientsSchema>,
  ): Promise<{ items: PatientListItem[]; total: number }> {
    return this.db.withClinic(ctx.user.clinicId, (tx) =>
      this.patients.search(tx, query.q, query.limit, query.offset),
    );
  }

  /** Opening a record is logged, because patient history is sensitive. */
  async get(ctx: ReqCtx, id: string): Promise<PatientRecord> {
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const patient = await this.patients.findById(tx, id);
      if (patient === null) throw notFound('This patient');
      await this.audit.record(tx, ctx, { action: 'patient.viewed', entity: 'patient', entityId: id });
      return patient;
    });
  }

  async update(ctx: ReqCtx, id: string, patch: UpdatePatient): Promise<PatientRecord> {
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const set = buildSet(
        {
          name: patch.name,
          name_key: patch.name === undefined ? undefined : nameKey(patch.name),
          phone: patch.phone,
          gender: patch.gender,
          birth_year: birthYearFor(patch.age),
          guardian_name: patch.guardianName,
          address: patch.address,
          allergies: patch.allergies,
          notes: patch.notes,
        },
        2,
      );
      if (set !== null) {
        const updated = await tx.execute(`update patients set ${set.sql} where id = $1`, [id, ...set.values]);
        if (updated === 0) throw notFound('This patient');
        await this.audit.record(tx, ctx, {
          action: 'patient.updated',
          entity: 'patient',
          entityId: id,
          meta: { fields: Object.keys(patch).join(',') },
        });
      }
      const patient = await this.patients.findById(tx, id);
      if (patient === null) throw notFound('This patient');
      return patient;
    });
  }
}
