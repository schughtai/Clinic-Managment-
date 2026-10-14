import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import type { ReqCtx } from '../../common/request-context';
import { pageSchema } from '../../common/validate';
import { DbService } from '../../db/db.service';

export const auditQuerySchema = pageSchema.extend({
  entity: z.string().trim().min(1).max(40).optional(),
  action: z.string().trim().min(1).max(80).optional(),
});

export interface AuditEntry {
  id: number;
  action: string;
  entity: string | null;
  entityId: string | null;
  userName: string | null;
  meta: Record<string, unknown>;
  createdAt: Date;
}

/** Each table is read as a list of JSON objects. Secrets are removed by name, never by hoping they are absent. */
const EXPORT_TABLES: readonly { key: string; sql: string }[] = [
  { key: 'clinic', sql: 'select to_jsonb(c) as item from clinics c' },
  { key: 'users', sql: "select to_jsonb(u) - 'password_hash' - 'token_version' - 'failed_logins' - 'locked_until' as item from users u order by created_at" },
  { key: 'doctors', sql: 'select to_jsonb(d) as item from doctors d order by created_at' },
  { key: 'doctorSchedules', sql: 'select to_jsonb(s) as item from doctor_schedules s' },
  { key: 'doctorLeaves', sql: 'select to_jsonb(l) as item from doctor_leaves l' },
  { key: 'patients', sql: "select to_jsonb(p) - 'name_key' as item from patients p order by patient_no" },
  { key: 'appointments', sql: 'select to_jsonb(a) as item from appointments a order by starts_at' },
  { key: 'visits', sql: 'select to_jsonb(v) as item from visits v order by visited_at' },
  { key: 'photos', sql: "select to_jsonb(a) - 'storage_key' - 'sha256' as item from visit_attachments a order by created_at" },
  { key: 'prescriptions', sql: 'select to_jsonb(p) as item from prescriptions p order by created_at' },
  { key: 'prescriptionTemplates', sql: 'select to_jsonb(t) as item from prescription_templates t order by name' },
  { key: 'invoices', sql: 'select to_jsonb(i) as item from invoices i order by invoice_no' },
  { key: 'invoiceItems', sql: 'select to_jsonb(i) as item from invoice_items i order by id' },
  { key: 'payments', sql: 'select to_jsonb(p) as item from payments p order by received_at' },
  { key: 'dayClosings', sql: 'select to_jsonb(d) as item from day_closings d order by closing_date' },
];

@Injectable()
export class ExportService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Everything the clinic owns, as one JSON document, so an owner is never locked in.
   * Photos are listed but their image files are not included. Read in one transaction so the snapshot is consistent.
   */
  async exportAll(ctx: ReqCtx): Promise<Record<string, unknown>> {
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const data: Record<string, unknown> = { exportedAt: new Date().toISOString(), format: 'clinic-export-v1' };
      for (const table of EXPORT_TABLES) {
        const rows = await tx.many<{ item: unknown }>(table.sql);
        const values = rows.map((row) => row.item);
        data[table.key] = table.key === 'clinic' ? (values[0] ?? null) : values;
      }
      await this.audit.record(tx, ctx, { action: 'export.downloaded' });
      return data;
    });
  }

  listAudit(ctx: ReqCtx, query: z.output<typeof auditQuerySchema>): Promise<{ items: AuditEntry[]; total: number }> {
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const where = 'where ($1::text is null or a.entity = $1) and ($2::text is null or a.action = $2)';
      const params = [query.entity ?? null, query.action ?? null];
      const items = await tx.many<AuditEntry>(
        `select a.id::int as id, a.action, a.entity, a.entity_id as "entityId", u.name as "userName", a.meta, a.created_at as "createdAt"
           from audit_log a left join users u on u.id = a.user_id
           ${where} order by a.id desc limit $3 offset $4`,
        [...params, query.limit, query.offset],
      );
      const count = await tx.one<{ total: number }>(`select count(*)::int as total from audit_log a ${where}`, params);
      return { items, total: count.total };
    });
  }
}
