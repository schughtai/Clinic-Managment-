import { Controller, Get, Inject, Query } from '@nestjs/common';
import { z } from 'zod';
import { Permission, Platform } from '../../common/access';
import { Ctx, type ReqCtx } from '../../common/request-context';
import { parse } from '../../common/validate';
import { DbService } from '../../db/db.service';
import { orgDb, platformDb } from '../identity/access.guard';

const PAGE = 50;

const filterSchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  actor: z.string().uuid().optional(),
  action: z
    .string()
    .trim()
    .regex(/^[a-z_.]{1,60}$/)
    .optional(),
  /** Opaque position from the previous page. */
  cursor: z
    .string()
    .regex(/^[A-Za-z0-9_-]{10,200}$/)
    .optional(),
  org: z.string().uuid().optional(),
});

export interface AuditEntry {
  id: string;
  at: string;
  actorId: string | null;
  actor: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  organizationId?: string | null;
  details: Record<string, unknown>;
}

interface Row {
  id: string;
  occurred_at: Date;
  actor_person_id: string | null;
  actor_label: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  organization_id?: string | null;
  details: Record<string, unknown>;
}

function decodeCursor(cursor: string | undefined): { at: string; id: string } | null {
  if (cursor === undefined) return null;
  try {
    const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (at === undefined || id === undefined || Number.isNaN(Date.parse(at)) || !/^[0-9a-f-]{36}$/.test(id)) return null;
    return { at, id };
  } catch {
    return null;
  }
}

const encodeCursor = (row: Row): string => Buffer.from(`${row.occurred_at.toISOString()}|${row.id}`, 'utf8').toString('base64url');

/**
 * Filters common to both logs. `to` includes the whole day. Newest first, keyset pagination.
 * The table name is one of two constants, never user input.
 */
function buildQuery(table: 'audit_events' | 'platform_audit_events', filter: z.infer<typeof filterSchema>) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (filter.from !== undefined) add('occurred_at >= ?::date', filter.from);
  if (filter.to !== undefined) add(`occurred_at < (?::date + interval '1 day')`, filter.to);
  if (filter.actor !== undefined) add('actor_person_id = ?', filter.actor);
  if (filter.action !== undefined) add(`action like ? || '%'`, filter.action);
  if (table === 'platform_audit_events' && filter.org !== undefined) add('organization_id = ?', filter.org);
  const cursor = decodeCursor(filter.cursor);
  if (cursor !== null) {
    params.push(cursor.at, cursor.id);
    where.push(`(occurred_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
  }
  params.push(PAGE + 1);
  const sql = `select * from ${table} ${where.length > 0 ? `where ${where.join(' and ')}` : ''}
               order by occurred_at desc, id desc limit $${params.length}`;
  return { sql, params };
}

function page(rows: Row[], withOrg: boolean): { entries: AuditEntry[]; nextCursor: string | null } {
  const more = rows.length > PAGE;
  const shown = rows.slice(0, PAGE);
  return {
    entries: shown.map((row) => ({
      id: row.id,
      at: row.occurred_at.toISOString(),
      actorId: row.actor_person_id,
      actor: row.actor_label,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      ...(withOrg ? { organizationId: row.organization_id ?? null } : {}),
      details: row.details,
    })),
    nextCursor: more && shown.length > 0 ? encodeCursor(shown[shown.length - 1]!) : null,
  };
}

@Controller()
export class AuditController {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  @Permission('audit.read')
  @Get('orgs/:slug/audit')
  org(@Ctx() ctx: ReqCtx, @Query() query: unknown) {
    const { sql, params } = buildQuery('audit_events', parse(filterSchema, query));
    return this.db.withContext(orgDb(ctx), async (tx) => page(await tx.many<Row>(sql, params), false));
  }

  @Platform()
  @Get('platform/audit')
  platform(@Ctx() ctx: ReqCtx, @Query() query: unknown) {
    const { sql, params } = buildQuery('platform_audit_events', parse(filterSchema, query));
    return this.db.withContext(platformDb(ctx), async (tx) => page(await tx.many<Row>(sql, params), true));
  }
}
