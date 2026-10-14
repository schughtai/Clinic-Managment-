import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import type { ReqCtx } from '../../common/request-context';
import { nullableText } from '../../common/validate';
import { phoneSchema } from '../../common/schemas';
import { CONFIG, type AppConfig } from '../../config/config';
import { DbService } from '../../db/db.service';
import { buildSet } from '../../db/sql';

export interface ClinicSettings {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  locale: 'en' | 'ur';
  timezone: string;
  aiEnabled: boolean;
  aiAvailable: boolean;
  modules: string[];
}

export const updateClinicSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: phoneSchema.nullable().optional(),
  address: nullableText(300),
  city: nullableText(80),
  locale: z.enum(['en', 'ur']).optional(),
  aiEnabled: z.boolean().optional(),
});
export type UpdateClinic = z.output<typeof updateClinicSchema>;

const SELECT_CLINIC = `
  select id, name, phone, address, city, locale, timezone,
         ai_enabled as "aiEnabled", modules
    from clinics where id = $1`;

type ClinicRow = Omit<ClinicSettings, 'aiAvailable'>;

@Injectable()
export class ClinicService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async get(ctx: ReqCtx): Promise<ClinicSettings> {
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const row = await tx.one<ClinicRow>(SELECT_CLINIC, [ctx.user.clinicId]);
      return this.withAvailability(row);
    });
  }

  async update(ctx: ReqCtx, patch: UpdateClinic): Promise<ClinicSettings> {
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const set = buildSet(
        {
          name: patch.name,
          phone: patch.phone,
          address: patch.address,
          city: patch.city,
          locale: patch.locale,
          ai_enabled: patch.aiEnabled,
        },
        2,
      );
      if (set !== null) {
        await tx.execute(`update clinics set ${set.sql} where id = $1`, [ctx.user.clinicId, ...set.values]);
        await this.audit.record(tx, ctx, {
          action: 'clinic.updated',
          entity: 'clinic',
          entityId: ctx.user.clinicId,
          meta: { fields: Object.keys(patch).join(',') },
        });
      }
      const row = await tx.one<ClinicRow>(SELECT_CLINIC, [ctx.user.clinicId]);
      return this.withAvailability(row);
    });
  }

  private withAvailability(row: ClinicRow): ClinicSettings {
    return { ...row, aiAvailable: this.config.anthropicApiKey !== undefined };
  }
}
