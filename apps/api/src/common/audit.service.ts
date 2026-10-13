import { Injectable } from '@nestjs/common';
import type { Tx } from '../db/tx';
import type { ReqCtx } from './request-context';

export interface AuditEvent {
  action: string;
  entity?: string;
  entityId?: string;
  /** Small facts about the event. Never put patient notes, passwords or message text here. */
  meta?: Record<string, string | number | boolean | null>;
}

@Injectable()
export class AuditService {
  /** Writes inside the caller's transaction, so an action and its audit entry succeed or fail together. */
  async record(tx: Tx, ctx: ReqCtx, event: AuditEvent): Promise<void> {
    await tx.execute(
      'insert into audit_log (clinic_id, user_id, action, entity, entity_id, meta, request_id) values ($1, $2, $3, $4, $5, $6, $7)',
      [
        ctx.user.clinicId,
        ctx.user.id,
        event.action,
        event.entity ?? null,
        event.entityId ?? null,
        JSON.stringify(event.meta ?? {}),
        ctx.requestId ?? null,
      ],
    );
  }
}
