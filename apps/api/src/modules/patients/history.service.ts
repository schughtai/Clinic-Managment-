import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit.service';
import { badRequest, notFound } from '../../common/errors';
import { type ReqCtx } from '../../common/request-context';
import { DbService } from '../../db/db.service';
import type { Tx } from '../../db/tx';
import { orgDb } from '../identity/access.guard';
import { cleanContent, HISTORY_SECTIONS, type HistorySection } from './history.schemas';

export interface HistoryEntry {
  id: string;
  section: HistorySection;
  content: Record<string, unknown>;
  source: string;
  status: string;
  recordedAt: string;
  supersedesId: string | null;
}

export interface HistorySectionView {
  section: HistorySection;
  /** not_assessed, unknown, patient_reports_none, or has_entries when entries exist. */
  state: string;
  entries: HistoryEntry[];
}

/**
 * Medical history. Entries are only ever added: a correction records a new entry that supersedes the
 * old one, and the database refuses updates and deletes (see history_guard in 0002).
 */
@Injectable()
export class HistoryService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** The current view of every section. A section with nothing recorded and no assessment reads "not assessed". */
  async list(ctx: ReqCtx, patientId: string): Promise<HistorySectionView[]> {
    return this.db.withContext(orgDb(ctx), async (tx) => {
      await this.assertPatient(tx, patientId);
      const rows = await tx.many<{
        id: string;
        section: HistorySection;
        content: Record<string, unknown>;
        source: string;
        status: string;
        recordedAt: string;
        supersedesId: string | null;
      }>(
        `select e.id, e.section, e.content, e.source, e.status, e.recorded_at as "recordedAt", e.supersedes_id as "supersedesId"
         from history_entries e
         where e.patient_id = $1 and e.status = 'active'
           and not exists (select 1 from history_entries n where n.supersedes_id = e.id)
         order by e.recorded_at desc`,
        [patientId],
      );
      const assessments = await tx.many<{ section: HistorySection; state: string }>(
        `select distinct on (section) section, state from history_assessments
         where patient_id = $1 order by section, recorded_at desc`,
        [patientId],
      );
      const assessed = new Map(assessments.map((a) => [a.section, a.state]));
      return HISTORY_SECTIONS.map((section) => {
        const entries = rows.filter((row) => row.section === section);
        const state = entries.length > 0 ? 'has_entries' : (assessed.get(section) ?? 'not_assessed');
        return { section, state, entries };
      });
    });
  }

  /** Adds an entry. With `supersedesId`, the new entry replaces an earlier one as a correction. */
  async add(
    ctx: ReqCtx,
    patientId: string,
    input: { section: HistorySection; content: Record<string, unknown>; source: string; supersedesId?: string },
  ) {
    const content = cleanContent(input.section, input.content);
    return this.db.withContext(orgDb(ctx), async (tx) => {
      await this.assertPatient(tx, patientId);
      if (input.supersedesId !== undefined) {
        const old = await tx.maybeOne<{ section: string; patient_id: string }>(
          'select section, patient_id from history_entries where id = $1',
          [input.supersedesId],
        );
        if (old === null || old.patient_id !== patientId) throw notFound('History entry');
        if (old.section !== input.section) throw badRequest('validation_failed', 'A correction must stay in the same section.');
        const already = await tx.maybeOne('select 1 from history_entries where supersedes_id = $1', [input.supersedesId]);
        if (already !== null) throw badRequest('already_corrected', 'That entry has already been corrected.');
      }
      const row = await tx.one<{ id: string }>(
        `insert into history_entries (organization_id, patient_id, section, content, source, author_id, supersedes_id)
         values ((select organization_id from patients where id = $1), $1, $2, $3, $4, $5, $6)
         returning id`,
        [patientId, input.section, JSON.stringify(content), input.source, ctx.person.id, input.supersedesId ?? null],
      );
      await this.audit.org(tx, ctx, 'history.recorded', { type: 'patient', id: patientId }, {
        section: input.section,
        entryId: row.id,
      });
      return { id: row.id };
    });
  }

  /** Records that a section was asked about and the answer. Only the latest answer counts. */
  async assess(ctx: ReqCtx, patientId: string, section: HistorySection, state: 'not_assessed' | 'unknown' | 'patient_reports_none') {
    return this.db.withContext(orgDb(ctx), async (tx) => {
      await this.assertPatient(tx, patientId);
      await tx.execute(
        `insert into history_assessments (organization_id, patient_id, section, state, recorded_by)
         values ((select organization_id from patients where id = $1), $1, $2, $3, $4)`,
        [patientId, section, state, ctx.person.id],
      );
      await this.audit.org(tx, ctx, 'history.assessed', { type: 'patient', id: patientId }, { section, state });
      return { ok: true };
    });
  }

  private async assertPatient(tx: Tx, patientId: string): Promise<void> {
    const found = await tx.maybeOne('select 1 from patients where id = $1 and merged_into is null', [patientId]);
    if (found === null) throw notFound('Patient');
  }
}
