import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DatabaseError } from 'pg';
import { AppError, invitationInvalid } from '../../common/errors';
import type { ReqCtx } from '../../common/request-context';
import { CONFIG, type AppConfig } from '../../config/config';
import { DbService } from '../../db/db.service';
import type { Tx } from '../../db/tx';
import { PasswordService } from '../identity/password.service';
import { deviceLabel, SessionService } from '../identity/session.service';
import { hashToken, newToken } from '../identity/tokens';
import { whatsappUrl } from '../identity/identity-helpers';

export const INVITATION_HOURS = 72;

export interface ShareLink {
  link: string;
  whatsappUrl: string;
  expiresAt: string;
}

export interface InvitationInput {
  inviteeName: string;
  phone: string | null;
  email: string | null;
  roleIds: readonly string[];
  facilityScope: 'all' | 'selected';
  facilityIds: readonly string[];
}

/**
 * Invitations are single-use links valid for 72 hours. Only a hash of the token is stored, and the
 * token travels in the URL fragment so it never reaches server logs.
 */
@Injectable()
export class InvitationsService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** Inserts an invitation in the caller's transaction (organization or platform context). */
  async create(tx: Tx, orgId: string, orgName: string, input: InvitationInput, createdBy: string): Promise<{ id: string; share: ShareLink }> {
    const token = newToken();
    const row = await tx.one<{ id: string; expires_at: Date }>(
      `insert into invitations (organization_id, token_hash, invitee_name, invitee_phone, invitee_email, role_ids,
                                facility_scope, facility_ids, expires_at, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(hours => $9), $10)
       returning id, expires_at`,
      [
        orgId,
        hashToken(token),
        input.inviteeName,
        input.phone,
        input.email,
        input.roleIds,
        input.facilityScope,
        input.facilityScope === 'all' ? [] : input.facilityIds,
        INVITATION_HOURS,
        createdBy,
      ],
    );
    return { id: row.id, share: this.share('invite', token, row.expires_at, input.phone, `You are invited to join ${orgName} on Clinic Management.`) };
  }

  /** Builds the one-time link and a WhatsApp click-to-send message for it. */
  share(kind: 'invite' | 'reset', token: string, expiresAt: Date, phone: string | null, intro: string): ShareLink {
    const link = `${this.config.publicOrigin}/${kind}#${token}`;
    const action = kind === 'invite' ? 'Open this link to accept' : 'Open this link to set a new password';
    const hours = kind === 'invite' ? INVITATION_HOURS : 24;
    return {
      link,
      whatsappUrl: whatsappUrl(phone, `${intro} ${action} (valid for ${hours} hours): ${link}`),
      expiresAt: expiresAt.toISOString(),
    };
  }

  async lookup(token: string): Promise<{ organizationName: string; inviteeName: string; roles: string[]; accountExists: boolean; expiresAt: string }> {
    const row = await this.db.withoutContext((tx) =>
      tx.maybeOne<{ organization_name: string; invitee_name: string; role_names: string[]; account_exists: boolean; expires_at: Date }>(
        'select * from invitation_lookup($1)',
        [hashToken(token)],
      ),
    );
    if (row === null) throw invitationInvalid();
    return {
      organizationName: row.organization_name,
      inviteeName: row.invitee_name,
      roles: row.role_names,
      accountExists: row.account_exists,
      expiresAt: row.expires_at.toISOString(),
    };
  }

  /**
   * Accepts once. A new person sets a password here; an existing person must already be signed in.
   * The caller ends up signed in, with the organization as active context.
   */
  async accept(
    token: string,
    input: { password: string | undefined; displayName: string | undefined },
    ctx: ReqCtx | undefined,
    request: Request,
    response: Response,
  ): Promise<{ destination: string }> {
    const passwordHash = input.password === undefined ? null : await this.passwords.hash(input.password);
    try {
      return await this.db.withoutContext(async (tx) => {
        const accepted = await tx.one<{ person_id: string; organization_id: string; org_slug: string }>(
          'select * from invitation_accept($1, $2, $3, $4)',
          [hashToken(token), ctx?.person.id ?? null, input.displayName ?? null, passwordHash],
        );
        let sessionId = ctx?.person.id === accepted.person_id ? ctx.sessionId : null;
        if (sessionId === null) {
          sessionId = await this.sessions.create(tx, response, accepted.person_id, 'password', deviceLabel(request.header('user-agent')));
        }
        await tx.execute("select set_config('app.person_id', $1, true)", [accepted.person_id]);
        const facilities = await tx.one<{ facilities: Array<{ id: string }> }>(
          'select facilities from my_memberships() where organization_id = $1',
          [accepted.organization_id],
        );
        const only = facilities.facilities.length === 1 ? facilities.facilities[0]!.id : null;
        await this.sessions.setContext(tx, sessionId, accepted.organization_id, only);
        return { destination: `/app/${accepted.org_slug}/dashboard` };
      });
    } catch (error) {
      if (error instanceof DatabaseError && error.code === 'P0001') {
        switch (error.message) {
          case 'invitation_invalid':
            throw invitationInvalid();
          case 'sign_in_required':
            throw new AppError(409, 'sign_in_required', 'You already have an account. Sign in first, then open the invitation link again.');
          case 'already_member':
            throw new AppError(409, 'already_member', 'You are already a member of this organization.');
          case 'password_required':
            throw new AppError(400, 'password_required', 'Choose a password to create your account.');
        }
      }
      throw error;
    }
  }
}
