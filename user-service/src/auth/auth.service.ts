import { Injectable, Inject, UnauthorizedException } from '@nestjs/common';
import type { RedisClientType } from 'redis';
import { REDIS } from '../redis/redis.provider.js';
import { SecretService } from '../secret/secret.service.js';
import { registrationTokenRecordKey } from '../common/hash/token-keys.js';
import { getRegisterUserScript } from '../scripts/retrieve-script.js';

export const REGISTER_USER_SCRIPT = getRegisterUserScript();

@Injectable()
export class AuthService {
  constructor(
    @Inject(REDIS) private redis: RedisClientType,
    private secretService: SecretService,
  ) {}

  /**
   * Validates the registration token and, on success, atomically consumes it
   * and returns the email it is bound to.
   *
   * The existence check, the not-yet-consumed check and the consumption stamp
   * share one Redis script, so a token can never be consumed without being
   * validated, nor replayed to register a second account.
   *
   * Returns the bound email on success, or null for every rejected condition
   * (unknown/expired token, already consumed) alike.
   */
  async registerWithToken(
    token: string,
    // Registration payload (validated by RegisterDto); feeds account creation
    // in the next step of M.1.
    displayName: string,
    password: string,
  ): Promise<string | null> {
    // Obtain redis key for registration token
    const registrationKey = registrationTokenRecordKey(
      token,
      this.secretService.getServerSecret(),
    );

    const result = await this.redis.eval(REGISTER_USER_SCRIPT, {
      keys: [registrationKey],
      arguments: [new Date().toISOString()],
    });

    if (result === 0) {
      throw new UnauthorizedException('Invalid Registration Token');
    }
    const email = result as string;

    // TODO: Wire database, write user
    console.log(`Creating user with - ${displayName}:${email}:${password}`);

    return result === 0 ? null : (result as string);
  }
}
