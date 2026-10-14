import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuditService, actorOf } from '../../common/audit.service';
import { AppError, accountLocked, badRequest, contextRequired, mfaInvalid, notFound, unauthorized } from '../../common/errors';
import type { ReqCtx } from '../../common/request-context';
import { CONFIG, type AppConfig } from '../../config/config';
import { DbService } from '../../db/db.service';
import type { Tx } from '../../db/tx';
import { open, seal } from './crypto-box';
import { normalizeIdentifier } from './identity-helpers';
import { PasswordService } from './password.service';
import { isPermission, isModule } from './permissions';
import { deviceLabel, SessionService } from './session.service';
import { hashToken } from './tokens';
import { base32Encode, newTotpSecret, otpauthUri, verifyTotp } from './totp';

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
const RECOVERY_CODES = 10;

export type NextStep = 'mfa_enroll' | 'mfa' | 'choose_context' | 'ready';
export interface StepResult {
  next: NextStep;
  destination?: string;
}

interface FoundPerson {
  id: string;
  display_name: string;
  password_hash: string;
  locked_until: Date | null;
  mfa_enabled: boolean;
}

interface MembershipRow {
  membership_id: string;
  organization_id: string;
  org_slug: string;
  org_name: string;
  org_status: string;
  default_language: 'en' | 'ur';
  facility_scope: 'all' | 'selected';
  role_names: string[];
  facilities: Array<{ id: string; name: string }>;
}

export interface MeResult {
  person: { id: string; displayName: string; language: 'en' | 'ur'; mfaEnabled: boolean };
  isPlatformAdmin: boolean;
  authLevel: 'password' | 'mfa';
  memberships: Array<{
    orgSlug: string;
    orgName: string;
    orgStatus: string;
    roles: string[];
    facilityScope: 'all' | 'selected';
    facilities: Array<{ id: string; name: string }>;
  }>;
  context: { orgSlug: string | null; facilityId: string | null };
  permissions: string[];
  modules: string[];
  org: { slug: string; name: string; status: string; defaultLanguage: 'en' | 'ur' } | null;
}

const OPERATING = new Set(['setup_required', 'active']);

function recoveryHash(code: string): Buffer {
  return createHash('sha256').update(code.toUpperCase().replace(/[^A-Z0-9]/g, ''), 'utf8').digest();
}

function newRecoveryCode(): string {
  const text = base32Encode(randomBytes(7)).slice(0, 10);
  return `${text.slice(0, 5)}-${text.slice(5)}`;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  // ------------------------------------------------------------ sign-in

  async login(identifierInput: string, password: string, request: Request, response: Response): Promise<StepResult> {
    const identifier = normalizeIdentifier(identifierInput);
    const found =
      identifier === null
        ? null
        : await this.db.withoutContext((tx) => tx.maybeOne<FoundPerson>('select * from auth_find_person($1)', [identifier]));

    if (found === null) {
      // Same work as a real check, so the response time does not reveal whether the account exists.
      await this.passwords.verifyDummy(password);
      await this.db.withoutContext((tx) =>
        this.audit.platform(tx, null, 'auth.login_failed', { requestId: request.requestId, details: { reason: 'unknown_account' } }),
      );
      throw unauthorized('The phone number, email or password is not right.');
    }
    if (found.locked_until !== null && found.locked_until > new Date()) throw accountLocked();

    const ok = await this.passwords.verify(password, found.password_hash);
    const actor = { id: found.id, label: found.display_name };
    if (!ok) {
      const lockedNow = await this.db.withoutContext(async (tx) => {
        const row = await tx.one<{ locked: boolean }>('select auth_record_login($1, false, $2, $3) as locked', [
          found.id,
          MAX_FAILED_LOGINS,
          LOCK_MINUTES,
        ]);
        await this.audit.platform(tx, actor, row.locked ? 'auth.account_locked' : 'auth.login_failed', { requestId: request.requestId });
        return row.locked;
      });
      if (lockedNow) throw accountLocked();
      throw unauthorized('The phone number, email or password is not right.');
    }

    return this.db.withContext({ personId: found.id }, async (tx) => {
      await tx.execute('select auth_record_login($1, true, $2, $3)', [found.id, MAX_FAILED_LOGINS, LOCK_MINUTES]);
      const platformAdmin = (await tx.one<{ ok: boolean }>('select auth_is_platform_admin($1) as ok', [found.id])).ok;
      const sessionId = await this.sessions.create(tx, response, found.id, 'password', deviceLabel(request.header('user-agent')));
      await this.audit.platform(tx, actor, 'auth.login', { requestId: request.requestId, target: { type: 'session', id: sessionId } });
      if (platformAdmin && !found.mfa_enabled) return { next: 'mfa_enroll' };
      if (found.mfa_enabled) return { next: 'mfa' };
      return this.afterSignIn(tx, sessionId, platformAdmin);
    });
  }

  /** Picks the context automatically when there is only one choice. */
  private async afterSignIn(tx: Tx, sessionId: string, platformAdmin: boolean): Promise<StepResult> {
    const memberships = await tx.many<MembershipRow>('select * from my_memberships()');
    const operating = memberships.filter((m) => OPERATING.has(m.org_status));
    if (platformAdmin) {
      if (memberships.length === 0) return { next: 'ready', destination: '/platform' };
      return { next: 'choose_context' };
    }
    const only = operating.length === 1 && memberships.length === 1 ? operating[0] : undefined;
    // Exactly one branch: go straight in. None: the choose screen explains there is no branch access.
    if (only !== undefined && only.facilities.length === 1) {
      await this.sessions.setContext(tx, sessionId, only.organization_id, only.facilities[0]!.id);
      return { next: 'ready', destination: `/app/${only.org_slug}/dashboard` };
    }
    return { next: 'choose_context' };
  }

  async logout(request: Request, response: Response): Promise<void> {
    const token = this.sessions.tokenOf(request);
    if (token !== undefined) await this.db.withoutContext((tx) => this.sessions.revokeToken(tx, token, 'sign_out'));
    this.sessions.clear(response);
  }

  // ------------------------------------------------------------ authenticator

  async enrollStart(ctx: ReqCtx): Promise<{ otpauthUri: string; secretBase32: string }> {
    return this.db.withContext({ personId: ctx.person.id }, async (tx) => {
      const person = await tx.one<{ enabled: boolean; phone: string | null; email: string | null }>(
        'select mfa_enabled_at is not null as enabled, phone, email from persons where id = $1',
        [ctx.person.id],
      );
      if (person.enabled) throw new AppError(409, 'mfa_already_enrolled', 'An authenticator is already set up for this account.');
      const secret = newTotpSecret();
      await tx.execute('update persons set mfa_pending_secret_enc = $1 where id = $2', [seal(this.config.mfaKey, secret), ctx.person.id]);
      const account = person.email ?? (person.phone === null ? ctx.person.displayName : `+${person.phone}`);
      return { otpauthUri: otpauthUri(secret, 'Clinic Management', account), secretBase32: base32Encode(secret) };
    });
  }

  async enrollConfirm(ctx: ReqCtx, code: string, request: Request): Promise<StepResult & { recoveryCodes: string[] }> {
    return this.db.withContext({ personId: ctx.person.id }, async (tx) => {
      const person = await tx.one<{ pending: Buffer | null; enabled: boolean }>(
        'select mfa_pending_secret_enc as pending, mfa_enabled_at is not null as enabled from persons where id = $1 for update',
        [ctx.person.id],
      );
      if (person.enabled) throw new AppError(409, 'mfa_already_enrolled', 'An authenticator is already set up for this account.');
      if (person.pending === null) throw badRequest('mfa_not_started', 'Start the authenticator setup again.');
      const secret = open(this.config.mfaKey, person.pending);
      const step = verifyTotp(secret, code, Date.now() / 1000, null);
      if (step === null) throw mfaInvalid();

      await tx.execute(
        `update persons set mfa_secret_enc = mfa_pending_secret_enc, mfa_pending_secret_enc = null,
           mfa_enabled_at = now(), mfa_last_step = $1 where id = $2`,
        [step.toString(), ctx.person.id],
      );
      const codes = Array.from({ length: RECOVERY_CODES }, newRecoveryCode);
      await tx.execute('delete from mfa_recovery_codes where person_id = $1', [ctx.person.id]);
      for (const recovery of codes) {
        await tx.execute('insert into mfa_recovery_codes (person_id, code_hash) values ($1, $2)', [ctx.person.id, recoveryHash(recovery)]);
      }
      await this.sessions.setLevel(tx, ctx.sessionId, 'mfa');
      await this.audit.platform(tx, actorOf(ctx), 'auth.mfa_enrolled', { requestId: request.requestId });
      const next = await this.afterSignIn(tx, ctx.sessionId, ctx.isPlatformAdmin);
      return { ...next, recoveryCodes: codes };
    });
  }

  async verify(ctx: ReqCtx, input: { code?: string | undefined; recoveryCode?: string | undefined }, request: Request): Promise<StepResult> {
    const result = await this.db.withContext({ personId: ctx.person.id }, async (tx) => {
      const person = await tx.one<{ secret: Buffer | null; last: string | null }>(
        'select mfa_secret_enc as secret, mfa_last_step::text as last from persons where id = $1 for update',
        [ctx.person.id],
      );
      if (person.secret === null) throw badRequest('mfa_not_enrolled', 'No authenticator is set up for this account.');

      let ok = false;
      if (input.code !== undefined) {
        const step = verifyTotp(open(this.config.mfaKey, person.secret), input.code, Date.now() / 1000, person.last === null ? null : BigInt(person.last));
        if (step !== null) {
          await tx.execute('update persons set mfa_last_step = $1 where id = $2', [step.toString(), ctx.person.id]);
          ok = true;
        }
      } else if (input.recoveryCode !== undefined) {
        const target = recoveryHash(input.recoveryCode);
        const codes = await tx.many<{ id: string; code_hash: Buffer }>(
          'select id, code_hash from mfa_recovery_codes where person_id = $1 and used_at is null',
          [ctx.person.id],
        );
        const match = codes.find((row) => row.code_hash.length === target.length && timingSafeEqual(row.code_hash, target));
        if (match !== undefined) {
          await tx.execute('update mfa_recovery_codes set used_at = now() where id = $1', [match.id]);
          await this.audit.platform(tx, actorOf(ctx), 'auth.recovery_code_used', { requestId: request.requestId });
          ok = true;
        }
      }
      if (!ok) return null;
      await this.sessions.setLevel(tx, ctx.sessionId, 'mfa');
      await this.audit.platform(tx, actorOf(ctx), 'auth.mfa_verified', { requestId: request.requestId });
      return this.afterSignIn(tx, ctx.sessionId, ctx.isPlatformAdmin);
    });
    if (result === null) {
      await this.db.withoutContext((tx) => this.audit.platform(tx, actorOf(ctx), 'auth.mfa_failed', { requestId: request.requestId }));
      throw mfaInvalid();
    }
    return result;
  }

  // ------------------------------------------------------------ profile and context

  async me(ctx: ReqCtx, request: Request): Promise<MeResult> {
    return this.db.withContext({ personId: ctx.person.id }, async (tx) => {
      const person = await tx.one<{ language: 'en' | 'ur'; mfa: boolean }>(
        'select preferred_language as language, mfa_enabled_at is not null as mfa from persons where id = $1',
        [ctx.person.id],
      );
      const session = await tx.one<{ org: string | null; facility: string | null }>(
        'select context_org as org, context_facility as facility from request_context($1, null)',
        [hashToken(this.sessions.tokenOf(request) ?? '')],
      );
      const memberships = ctx.authLevel === 'mfa' || (!person.mfa && !ctx.isPlatformAdmin) ? await tx.many<MembershipRow>('select * from my_memberships()') : [];
      const current = memberships.find((m) => m.organization_id === session.org && OPERATING.has(m.org_status));

      let permissions: string[] = [];
      let modules: string[] = [];
      let org: MeResult['org'] = null;
      if (current !== undefined) {
        const row = await tx.one<{ permissions: string[] | null; modules: string[] | null }>(
          'select permissions, org_modules as modules from request_context($1, $2)',
          [hashToken(this.sessions.tokenOf(request) ?? ''), current.org_slug],
        );
        permissions = (row.permissions ?? []).filter(isPermission).sort();
        modules = (row.modules ?? []).filter(isModule);
        org = { slug: current.org_slug, name: current.org_name, status: current.org_status, defaultLanguage: current.default_language };
      }

      return {
        person: { id: ctx.person.id, displayName: ctx.person.displayName, language: person.language, mfaEnabled: person.mfa },
        isPlatformAdmin: ctx.isPlatformAdmin,
        authLevel: ctx.authLevel,
        memberships: memberships.map((m) => ({
          orgSlug: m.org_slug,
          orgName: m.org_name,
          orgStatus: m.org_status,
          roles: m.role_names,
          facilityScope: m.facility_scope,
          facilities: m.facilities,
        })),
        context: { orgSlug: current?.org_slug ?? null, facilityId: current === undefined ? null : session.facility },
        permissions,
        modules,
        org,
      };
    });
  }

  /** Sets the active organization and facility. `orgSlug: null` leaves organization context (platform). */
  async setContext(ctx: ReqCtx, orgSlug: string | null, facilityId: string | null): Promise<void> {
    await this.db.withContext({ personId: ctx.person.id }, async (tx) => {
      if (orgSlug === null) {
        await this.sessions.setContext(tx, ctx.sessionId, null, null);
        return;
      }
      const memberships = await tx.many<MembershipRow>('select * from my_memberships()');
      const membership = memberships.find((m) => m.org_slug === orgSlug);
      if (membership === undefined) throw notFound('Organization');
      if (!OPERATING.has(membership.org_status)) throw new AppError(403, 'organization_suspended', 'This organization is suspended.');
      let facility: string | null = facilityId;
      if (facility === null) {
        if (membership.facilities.length === 1) facility = membership.facilities[0]!.id;
        else if (membership.facilities.length === 0) throw contextRequired();
      } else if (!membership.facilities.some((f) => f.id === facility)) {
        throw notFound('Branch');
      }
      await this.sessions.setContext(tx, ctx.sessionId, membership.organization_id, facility);
    });
  }

  async changePassword(ctx: ReqCtx, current: string, next: string, request: Request): Promise<void> {
    const hash = await this.db.withContext({ personId: ctx.person.id }, (tx) =>
      tx.one<{ password_hash: string }>('select password_hash from persons where id = $1', [ctx.person.id]),
    );
    if (!(await this.passwords.verify(current, hash.password_hash))) {
      throw badRequest('wrong_password', 'The current password is not right.');
    }
    const newHash = await this.passwords.hash(next);
    await this.db.withContext({ personId: ctx.person.id }, async (tx) => {
      await tx.execute('update persons set password_hash = $1 where id = $2', [newHash, ctx.person.id]);
      await this.sessions.revokePerson(tx, ctx.person.id, 'password_changed', ctx.sessionId);
      await this.audit.platform(tx, actorOf(ctx), 'auth.password_changed', { requestId: request.requestId });
    });
  }

  async setLanguage(ctx: ReqCtx, language: 'en' | 'ur'): Promise<void> {
    await this.db.withContext({ personId: ctx.person.id }, (tx) =>
      tx.execute('update persons set preferred_language = $1 where id = $2', [language, ctx.person.id]),
    );
  }
}
