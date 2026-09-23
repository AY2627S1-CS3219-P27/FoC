import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import type { RedisClientType } from 'redis';
import { QueryFailedError, Repository } from 'typeorm';
import { REDIS } from '../redis/redis.provider.js';
import { SecretService } from '../secret/secret.service.js';
import { hashValue } from '../common/hash/hash.js';
import { registrationTokenRecordKey } from '../common/hash/token-keys.js';
import { getRegisterUserScript } from '../scripts/retrieve-script.js';
import { User } from '../users/user.entity.js';

export const REGISTER_USER_SCRIPT = getRegisterUserScript();

/** The PostgreSQL driver error code for a unique-constraint violation.
 *
 *  Unfortunately, there is no library way to do this, we have to catch
 *  the DB error code.
 * */
const UNIQUE_VIOLATION_CODE = '23505';

export interface RegisteredUser {
  id: number;
  email: string;
  displayName: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(REDIS) private redis: RedisClientType,
    private secretService: SecretService,
    @InjectRepository(User) private userRepository: Repository<User>,
  ) {}

  /**
   * Validates the registration token and, on success, atomically consumes it
   * and provisions the user account bound to it.
   *
   * The existence check, the not-yet-consumed check and the consumption stamp
   * share one Redis script, so a token can never be consumed without being
   * validated, nor replayed to register a second account. Consumption happens
   * before the account is written, so a failed insert still burns the token.
   *
   * Returns the provisioned user on success. Rejects with
   * UnauthorizedException for every failed token condition (unknown/expired,
   * already consumed) alike, and with ConflictException if the token's bound
   * email turns out to be registered before the insert lands.
   */
  async registerWithToken(
    token: string,
    // Registration payload (validated by RegisterDto); feeds account creation
    // in the next step of M.1.
    displayName: string,
    password: string,
  ): Promise<RegisteredUser> {
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

    // Fresh per-account salt, stored next to the hash so the credentials can
    // be re-verified later without derivable state.
    const passwordSalt = randomBytes(16).toString('hex');
    const passwordHash = await hashValue(password, passwordSalt);

    try {
      const user = await this.userRepository.save(
        this.userRepository.create({
          email,
          displayName,
          passwordHash,
          passwordSalt,
          isActive: true,
        }),
      );

      return { id: user.id, email: user.email, displayName: user.displayName };
    } catch (error) {
      // UNIQUE_VIOLATION occurs when the same user is attempted to be inserted.
      // In this case, email matches an already-existing user.
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string } | null)?.code ===
          UNIQUE_VIOLATION_CODE
      ) {
        throw new ConflictException('Email is already registered.');
      }
      throw error;
    }
  }
}
