import { Inject, Injectable } from '@nestjs/common';
import { forbidden } from '../../common/errors';
import type { ReqCtx } from '../../common/request-context';
import type { Tx } from '../../db/tx';
import { VisitsRepository } from './visits.repository';

/** Who may change a visit and the things attached to it. One rule, used by every module that edits visits. */
@Injectable()
export class VisitAccess {
  constructor(@Inject(VisitsRepository) private readonly repo: VisitsRepository) {}

  /** Owners can correct any note. A doctor can change only their own, though every doctor can read. */
  async assertMayEdit(tx: Tx, ctx: ReqCtx, visitDoctorId: string): Promise<void> {
    if (ctx.user.role === 'owner') return;
    const mine = await this.repo.doctorProfileForUser(tx, ctx.user.id);
    if (mine === null || mine.id !== visitDoctorId) {
      throw forbidden('Only the doctor who saw the patient can change this note.');
    }
  }
}
