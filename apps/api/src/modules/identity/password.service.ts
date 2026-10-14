import { Inject, Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { CONFIG, type AppConfig } from '../../config/config';

@Injectable()
export class PasswordService {
  private readonly cost: number;
  private dummyHash: Promise<string> | undefined;

  constructor(@Inject(CONFIG) config: AppConfig) {
    // A low cost keeps the automated tests fast. Production always uses 12.
    this.cost = config.nodeEnv === 'test' ? 4 : 12;
  }

  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.cost);
  }

  verify(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }

  /** Spends the same time as a real check, so response time does not reveal whether a phone number exists. */
  async verifyDummy(plain: string): Promise<void> {
    this.dummyHash ??= bcrypt.hash('placeholder-password-for-timing', this.cost);
    await bcrypt.compare(plain, await this.dummyHash);
  }
}
