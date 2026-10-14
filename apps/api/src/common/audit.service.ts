import { Injectable } from '@nestjs/common';
import type { Tx } from '../db/tx';
import type { ReqCtx } from './request-context';

type DetailValue = string | number | boolean | null | readonly string[];
export type AuditDetails = Readonly<Record<string, DetailValue>>;

export interface AuditTarget {
  type?: string;
  id?: string;
  facilityId?: string;
}

/** Keys that must never be written to an audit entry, whatever the action. */
const FORBIDDEN_KEY = /password|token|secret|code|hash|otp|note|text/i;

/** Audit details are short facts, never secrets or clinical content. */
export function cleanDetails(details: AuditDetails | undefined): Record<string, DetailValue> {
  const clean: Record<string, DetailValue> = {};
  for (const [key, value] of Object.entries(details ?? {})) {
    if (FORBIDDEN_KEY.test(key)) {
      throw new Error(`Audit detail "${key}" is not allowed.`);
    }
    if (typeof value === 'string' && value.length > 200) {
      throw new Error(`Audit detail "${key}" is too long.`);
    }
    clean[key] = value;
  }
  return clean;
}

/**
 * Writes inside the caller's transaction, so an action and its audit entry succeed or fail together.
 * Organization events and platform events live in separate tables (FR-023).
 */
@Injectable()
export class AuditService {
  async org(tx: Tx, ctx: ReqCtx, action: string, target: AuditTarget = {}, details?: AuditDetails): Promise<void> {
    if (ctx.org === undefined) throw new Error('Organization audit needs an organization context.');
    await tx.execute(
      `insert into audit_events (organization_id, actor_person_id, actor_label, action, target_type, target_id, facility_id, request_id, details)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        ctx.org.id,
        ctx.person.id,
        ctx.person.displayName,
        action,
        target.type ?? null,
        target.id ?? null,
        target.facilityId ?? null,
        ctx.requestId ?? null,
        JSON.stringify(cleanDetails(details)),
      ],
    );
  }

  /** Platform and security events. `actor` is null for events by someone not yet identified. */
  async platform(
    tx: Tx,
    actor: { id: string; label: string } | null,
    action: string,
    options: { orgId?: string; target?: AuditTarget; requestId?: string; details?: AuditDetails } = {},
  ): Promise<void> {
    await tx.execute('select platform_audit($1, $2, $3, $4, $5, $6, $7, $8)', [
      actor?.id ?? null,
      actor?.label ?? 'anonymous',
      action,
      options.orgId ?? null,
      options.target?.type ?? null,
      options.target?.id ?? null,
      options.requestId ?? null,
      JSON.stringify(cleanDetails(options.details)),
    ]);
  }
}

export function actorOf(ctx: ReqCtx): { id: string; label: string } {
  return { id: ctx.person.id, label: ctx.person.displayName };
}
