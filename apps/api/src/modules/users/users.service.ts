import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { badRequest, conflict, forbidden, notFound } from '../../common/errors';
import { ROLES, type ReqCtx, type Role } from '../../common/request-context';
import { nameSchema, passwordSchema, phoneSchema } from '../../common/schemas';
import { DbService } from '../../db/db.service';
import { buildSet } from '../../db/sql';
import type { Tx } from '../../db/tx';
import { PasswordService } from '../auth/password.service';

export interface StaffUser {
  id: string;
  name: string;
  phone: string;
  role: Role;
  active: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export const createUserSchema = z.object({
  name: nameSchema,
  phone: phoneSchema,
  password: passwordSchema,
  role: z.enum(ROLES),
});
export const updateUserSchema = z.object({
  name: nameSchema.optional(),
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
});
export const resetPasswordSchema = z.object({ newPassword: passwordSchema });

export type CreateUser = z.output<typeof createUserSchema>;
export type UpdateUser = z.output<typeof updateUserSchema>;

const USER_COLUMNS = `id, name, phone, role, active, last_login_at as "lastLoginAt", created_at as "createdAt"`;

@Injectable()
export class UsersService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  list(ctx: ReqCtx): Promise<StaffUser[]> {
    return this.db.withClinic(ctx.user.clinicId, (tx) =>
      tx.many<StaffUser>(`select ${USER_COLUMNS} from users order by active desc, name`),
    );
  }

  async create(ctx: ReqCtx, input: CreateUser): Promise<StaffUser> {
    const hash = await this.passwords.hash(input.password);
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      await this.assertActorIsOwner(tx, ctx);
      const user = await tx.one<StaffUser>(
        `insert into users (clinic_id, name, phone, password_hash, role)
         values ($1, $2, $3, $4, $5) returning ${USER_COLUMNS}`,
        [ctx.user.clinicId, input.name, input.phone, hash, input.role],
      );
      if (input.role === 'doctor') await this.ensureDoctorProfile(tx, ctx.user.clinicId, user.id, user.name);
      await this.audit.record(tx, ctx, {
        action: 'user.created',
        entity: 'user',
        entityId: user.id,
        meta: { role: input.role },
      });
      return user;
    });
  }

  async update(ctx: ReqCtx, id: string, patch: UpdateUser): Promise<StaffUser> {
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      // Serialise owner changes. Without this lock, two owners could demote each other at the same
      // moment and leave the clinic with nobody in charge.
      await tx.many("select id from users where role = 'owner' and active order by id for update");
      await this.assertActorIsOwner(tx, ctx);
      const current = await tx.maybeOne<{ role: Role; active: boolean }>(
        'select role, active from users where id = $1 for update',
        [id],
      );
      if (current === null) throw notFound('This user');

      const nextRole = patch.role ?? current.role;
      const nextActive = patch.active ?? current.active;
      const sessionsMustEnd = nextRole !== current.role || nextActive !== current.active;

      if (id === ctx.user.id && (nextRole !== current.role || nextActive !== current.active)) {
        throw badRequest('cannot_change_self', 'You cannot change your own role or deactivate yourself.');
      }
      const losesOwnerAccess = current.role === 'owner' && current.active && (nextRole !== 'owner' || !nextActive);
      if (losesOwnerAccess) {
        const others = await tx.one<{ count: string }>(
          "select count(*) from users where role = 'owner' and active and id <> $1",
          [id],
        );
        if (Number(others.count) === 0) {
          throw conflict('last_owner', 'The clinic must keep at least one active owner.');
        }
      }

      const set = buildSet({ name: patch.name, role: patch.role, active: patch.active }, 2);
      if (set !== null) {
        const bump = sessionsMustEnd ? ', token_version = token_version + 1' : '';
        await tx.execute(`update users set ${set.sql}${bump} where id = $1`, [id, ...set.values]);
      }
      if (nextRole === 'doctor' && nextActive) {
        const user = await tx.one<{ name: string }>('select name from users where id = $1', [id]);
        await this.ensureDoctorProfile(tx, ctx.user.clinicId, id, user.name);
      }
      await this.audit.record(tx, ctx, {
        action: 'user.updated',
        entity: 'user',
        entityId: id,
        meta: { fields: Object.keys(patch).join(',') },
      });
      return tx.one<StaffUser>(`select ${USER_COLUMNS} from users where id = $1`, [id]);
    });
  }

  async resetPassword(ctx: ReqCtx, id: string, newPassword: string): Promise<void> {
    const hash = await this.passwords.hash(newPassword);
    await this.db.withClinic(ctx.user.clinicId, async (tx) => {
      await this.assertActorIsOwner(tx, ctx);
      const updated = await tx.execute(
        'update users set password_hash = $2, token_version = token_version + 1, failed_logins = 0, locked_until = null where id = $1',
        [id, hash],
      );
      if (updated === 0) throw notFound('This user');
      await this.audit.record(tx, ctx, { action: 'user.password_reset', entity: 'user', entityId: id });
    });
  }

  /** The session was checked before this transaction, so confirm the caller is still an active owner now. */
  private async assertActorIsOwner(tx: Tx, ctx: ReqCtx): Promise<void> {
    const actor = await tx.maybeOne<{ role: Role; active: boolean }>(
      'select role, active from users where id = $1',
      [ctx.user.id],
    );
    if (actor === null || !actor.active || actor.role !== 'owner') throw forbidden();
  }

  /** A doctor who can sign in also needs a doctor profile for schedules and appointments. */
  private async ensureDoctorProfile(tx: Tx, clinicId: string, userId: string, name: string): Promise<void> {
    await tx.execute(
      `insert into doctors (clinic_id, user_id, name) values ($1, $2, $3)
       on conflict (user_id) do update set active = true`,
      [clinicId, userId, name],
    );
  }
}
