import { createHash, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit.service';
import { AppError, notFound, unauthorized } from '../../common/errors';
import type { ReqCtx, Role } from '../../common/request-context';
import { CONFIG, type AppConfig } from '../../config/config';
import { DbService } from '../../db/db.service';
import { PasswordService } from './password.service';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

interface LoginRow {
  id: string;
  clinicId: string;
  name: string;
  role: Role;
  passwordHash: string;
  active: boolean;
  tokenVersion: number;
  lockedUntil: Date | null;
}

export interface SessionGrant {
  userId: string;
  clinicId: string;
  tokenVersion: number;
}

export interface Profile {
  user: { id: string; name: string; role: Role; phone: string };
  clinic: {
    id: string;
    name: string;
    locale: 'en' | 'ur';
    timezone: string;
    aiEnabled: boolean;
    aiAvailable: boolean;
    modules: string[];
  };
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** Checks credentials. The same error covers unknown phone, wrong password and deactivated account. */
  async login(phone: string | null, password: string): Promise<SessionGrant> {
    const found =
      phone === null
        ? null
        : await this.db.withoutClinic((tx) =>
            tx.maybeOne<LoginRow>(
              `select id, clinic_id as "clinicId", name, role, password_hash as "passwordHash",
                      active, token_version as "tokenVersion", locked_until as "lockedUntil"
                 from auth_find_user($1)`,
              [phone],
            ),
          );

    if (found === null || !found.active) {
      await this.passwords.verifyDummy(password);
      throw this.invalidCredentials();
    }
    if (found.lockedUntil !== null && found.lockedUntil.getTime() > Date.now()) {
      throw new AppError(429, 'account_locked', 'Too many failed attempts. Please try again in a few minutes.');
    }

    const passwordOk = await this.passwords.verify(password, found.passwordHash);
    await this.db.withoutClinic((tx) =>
      tx.execute('select auth_record_login($1, $2, $3, $4)', [found.id, passwordOk, MAX_FAILED_ATTEMPTS, LOCK_MINUTES]),
    );
    if (!passwordOk) throw this.invalidCredentials();

    return { userId: found.id, clinicId: found.clinicId, tokenVersion: found.tokenVersion };
  }

  /** Creates a new clinic and its owner. Disabled unless the server has a signup code. */
  async registerClinic(input: {
    signupCode: string;
    clinicName: string;
    ownerName: string;
    phone: string;
    password: string;
  }): Promise<SessionGrant> {
    const expected = this.config.signupCode;
    if (expected === undefined) throw notFound('This page');
    if (!timingSafeEqual(digest(input.signupCode), digest(expected))) {
      throw new AppError(403, 'invalid_signup_code', 'The signup code is not correct.');
    }
    const hash = await this.passwords.hash(input.password);
    const created = await this.db.withoutClinic((tx) =>
      tx.one<{ clinicId: string; userId: string }>(
        'select clinic_id as "clinicId", user_id as "userId" from register_clinic($1, $2, $3, $4)',
        [input.clinicName, input.ownerName, input.phone, hash],
      ),
    );
    return { userId: created.userId, clinicId: created.clinicId, tokenVersion: 0 };
  }

  async profile(ctx: ReqCtx): Promise<Profile> {
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const row = await tx.one<{
        phone: string;
        clinicId: string;
        clinicName: string;
        locale: 'en' | 'ur';
        timezone: string;
        aiEnabled: boolean;
        modules: string[];
      }>(
        `select u.phone, c.id as "clinicId", c.name as "clinicName", c.locale, c.timezone,
                c.ai_enabled as "aiEnabled", c.modules
           from users u join clinics c on c.id = u.clinic_id
          where u.id = $1`,
        [ctx.user.id],
      );
      return {
        user: { id: ctx.user.id, name: ctx.user.name, role: ctx.user.role, phone: row.phone },
        clinic: {
          id: row.clinicId,
          name: row.clinicName,
          locale: row.locale,
          timezone: row.timezone,
          aiEnabled: row.aiEnabled,
          aiAvailable: this.config.anthropicApiKey !== undefined,
          modules: row.modules,
        },
      };
    });
  }

  /** Changes the caller's password and signs out every other session. Returns the new grant. */
  async changePassword(ctx: ReqCtx, currentPassword: string, newPassword: string): Promise<SessionGrant> {
    const row = await this.db.withClinic(ctx.user.clinicId, (tx) =>
      tx.one<{ passwordHash: string; phone: string }>(
        'select password_hash as "passwordHash", phone from users where id = $1',
        [ctx.user.id],
      ),
    );
    if (!(await this.passwords.verify(currentPassword, row.passwordHash))) {
      throw new AppError(400, 'wrong_password', 'The current password is not correct.');
    }
    if (newPassword.replace(/\D/g, '') === row.phone) {
      throw new AppError(400, 'weak_password', 'The password cannot be your phone number.');
    }
    const hash = await this.passwords.hash(newPassword);
    const tokenVersion = await this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const updated = await tx.one<{ tokenVersion: number }>(
        'update users set password_hash = $2, token_version = token_version + 1 where id = $1 returning token_version as "tokenVersion"',
        [ctx.user.id, hash],
      );
      await this.audit.record(tx, ctx, { action: 'user.password_changed', entity: 'user', entityId: ctx.user.id });
      return updated.tokenVersion;
    });
    return { userId: ctx.user.id, clinicId: ctx.user.clinicId, tokenVersion };
  }

  private invalidCredentials(): AppError {
    return unauthorized('The phone number or password is not correct.');
  }
}
