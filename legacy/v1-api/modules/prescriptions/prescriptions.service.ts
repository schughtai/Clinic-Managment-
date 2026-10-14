import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { notFound } from '../../common/errors';
import type { ReqCtx } from '../../common/request-context';
import { dateSchema, nullableText } from '../../common/validate';
import { DbService } from '../../db/db.service';
import { VisitAccess } from '../visits/visit-access';
import { VisitsRepository } from '../visits/visits.repository';

export const prescriptionItemSchema = z
  .object({
    medicine: z.string().trim().min(1, 'Required.').max(120),
    dose: nullableText(60),
    frequency: nullableText(60),
    duration: nullableText(60),
    instructions: nullableText(200),
  })
  .strict();

const itemsSchema = z.array(prescriptionItemSchema).min(1, 'Add at least one medicine.').max(30);

export const savePrescriptionSchema = z
  .object({ items: itemsSchema, advice: nullableText(5_000), followUpOn: dateSchema.nullable().optional() })
  .strict();

export const saveTemplateSchema = z
  .object({ name: z.string().trim().min(1).max(80), items: itemsSchema, advice: nullableText(5_000) })
  .strict();

export interface PrescriptionItem {
  medicine: string;
  dose: string | null;
  frequency: string | null;
  duration: string | null;
  instructions: string | null;
}

export interface Prescription {
  id: string;
  visitId: string;
  items: PrescriptionItem[];
  advice: string | null;
  followUpOn: string | null;
  updatedAt: Date;
}

export interface Template {
  id: string;
  name: string;
  items: PrescriptionItem[];
  advice: string | null;
}

export interface PrescriptionPrint {
  clinic: { name: string; phone: string | null; address: string | null; city: string | null; locale: 'en' | 'ur' };
  patient: { name: string; patientNo: number; age: number | null; gender: string | null };
  doctor: { name: string; specialty: string | null };
  visitedAt: Date;
  /** Hidden from the reception desk, which has no access to clinical notes. */
  diagnosis: string | null;
  items: PrescriptionItem[];
  advice: string | null;
  followUpOn: string | null;
}

const PRESCRIPTION_COLUMNS = `
  id, visit_id as "visitId", items, advice,
  to_char(follow_up_on, 'YYYY-MM-DD') as "followUpOn", updated_at as "updatedAt"`;

@Injectable()
export class PrescriptionsService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(VisitsRepository) private readonly visits: VisitsRepository,
    @Inject(VisitAccess) private readonly access: VisitAccess,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async save(ctx: ReqCtx, visitId: string, input: z.output<typeof savePrescriptionSchema>): Promise<Prescription> {
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const visit = await this.visits.lockById(tx, visitId);
      if (visit === null) throw notFound('This visit');
      await this.access.assertMayEdit(tx, ctx, visit.doctorId);
      const saved = await tx.one<Prescription>(
        `insert into prescriptions (clinic_id, visit_id, items, advice, follow_up_on, created_by)
         values ($1, $2, $3::jsonb, $4, $5, $6)
         on conflict (visit_id) do update
           set items = excluded.items, advice = excluded.advice, follow_up_on = excluded.follow_up_on
         returning ${PRESCRIPTION_COLUMNS}`,
        [ctx.user.clinicId, visitId, JSON.stringify(normalise(input.items)), input.advice ?? null, input.followUpOn ?? null, ctx.user.id],
      );
      await this.audit.record(tx, ctx, {
        action: 'prescription.saved',
        entity: 'visit',
        entityId: visitId,
        meta: { medicines: input.items.length },
      });
      return saved;
    });
  }

  async get(ctx: ReqCtx, visitId: string): Promise<Prescription> {
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const found = await tx.maybeOne<Prescription>(
        `select ${PRESCRIPTION_COLUMNS} from prescriptions where visit_id = $1`,
        [visitId],
      );
      if (found === null) throw notFound('This prescription');
      return found;
    });
  }

  async forPrint(ctx: ReqCtx, visitId: string): Promise<PrescriptionPrint> {
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const row = await tx.maybeOne<Omit<PrescriptionPrint, 'diagnosis'> & { diagnosis: string | null }>(
        `select jsonb_build_object('name', c.name, 'phone', c.phone, 'address', c.address, 'city', c.city, 'locale', c.locale) as clinic,
                jsonb_build_object('name', pt.name, 'patientNo', pt.patient_no, 'gender', pt.gender,
                  'age', case when pt.birth_year is null then null else extract(year from now())::int - pt.birth_year end) as patient,
                jsonb_build_object('name', d.name, 'specialty', d.specialty) as doctor,
                v.visited_at as "visitedAt", v.diagnosis,
                p.items, p.advice, to_char(p.follow_up_on, 'YYYY-MM-DD') as "followUpOn"
           from prescriptions p
           join visits v on v.id = p.visit_id
           join patients pt on pt.id = v.patient_id
           join doctors d on d.id = v.doctor_id
           join clinics c on c.id = v.clinic_id
          where p.visit_id = $1`,
        [visitId],
      );
      if (row === null) throw notFound('This prescription');
      await this.audit.record(tx, ctx, { action: 'prescription.printed', entity: 'visit', entityId: visitId });
      return { ...row, diagnosis: ctx.user.role === 'receptionist' ? null : row.diagnosis };
    });
  }

  listTemplates(ctx: ReqCtx): Promise<Template[]> {
    return this.db.withClinic(ctx.user.clinicId, (tx) =>
      tx.many<Template>('select id, name, items, advice from prescription_templates order by name'),
    );
  }

  saveTemplate(ctx: ReqCtx, input: z.output<typeof saveTemplateSchema>): Promise<Template> {
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const saved = await tx.one<Template>(
        `insert into prescription_templates (clinic_id, name, items, advice, created_by)
         values ($1, $2, $3::jsonb, $4, $5) returning id, name, items, advice`,
        [ctx.user.clinicId, input.name, JSON.stringify(normalise(input.items)), input.advice ?? null, ctx.user.id],
      );
      await this.audit.record(tx, ctx, { action: 'prescription_template.created', entity: 'prescription_template', entityId: saved.id });
      return saved;
    });
  }

  async deleteTemplate(ctx: ReqCtx, id: string): Promise<void> {
    await this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const removed = await tx.execute('delete from prescription_templates where id = $1', [id]);
      if (removed === 0) throw notFound('This template');
      await this.audit.record(tx, ctx, { action: 'prescription_template.deleted', entity: 'prescription_template', entityId: id });
    });
  }
}

/** Stores every optional field explicitly, so saved items always have the same shape. */
function normalise(items: z.output<typeof itemsSchema>): PrescriptionItem[] {
  return items.map((item) => ({
    medicine: item.medicine,
    dose: item.dose ?? null,
    frequency: item.frequency ?? null,
    duration: item.duration ?? null,
    instructions: item.instructions ?? null,
  }));
}
