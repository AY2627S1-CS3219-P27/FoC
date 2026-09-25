import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { RedisClientType } from 'redis';
import { REDIS } from '../redis/redis.provider.js';
import { SecretService } from '../secret/secret.service.js';
import { registrationTokenRecordKey } from '../common/hash/token-keys.js';
import { getRegisterUserScript } from '../scripts/retrieve-script.js';
import {
  EmailAlreadyRegisteredError,
  UsersService,
} from '../users/users.service.js';
import { JwtService } from '@nestjs/jwt';
import { AuthenticatedUser } from './authenticated-user.js';

export const REGISTER_USER_SCRIPT = getRegisterUserScript();

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
    private usersService: UsersService,
    private jwtService: JwtService,
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

    try {
      return await this.usersService.provisionUser({
        email,
        displayName,
        password,
      });
    } catch (error) {
      if (error instanceof EmailAlreadyRegisteredError) {
        throw new ConflictException('Email is already registered.');
      }
      throw error;
    }
  }

  /**
   * Checks whether the provided (email, password) pair matches, and if so,
   * returns an object with an accessToken JWT.
   */
  async checkCredentials(email: string, password: string) {
    // Check if password matches
    const user = await this.usersService.checkUserAndReturnInfo(
      email,
      password,
    );

    // create JWT
    const payload: AuthenticatedUser = {
      sub: user.id,
      displayName: user.displayName,
      email: user.email,
      isAdmin: user.isAdmin,
      roles: user.roles,
    };
    return {
      accessToken: await this.jwtService.signAsync(payload),
    };
  }
}
