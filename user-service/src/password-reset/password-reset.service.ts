import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { REDIS } from '../redis/redis.provider.js';
import { SecretService } from '../secret/secret.service.js';
import type { RedisClientType } from 'redis';
import { ClientProxy } from '@nestjs/microservices';
import { EMAIL_SERVICE } from '../broker/broker.module.js';
import {
  getCreateResetTokenScript,
  getResetPasswordScript,
} from '../scripts/retrieve-script.js';
import {
  resetTokenCountKey,
  resetTokenRecordKey,
} from '../common/hash/token-keys.js';
import { UsersService } from '../users/users.service.js';

export const CREATE_RESET_TOKEN_SCRIPT = getCreateResetTokenScript();
export const RESET_PASSWORD_SCRIPT = getResetPasswordScript();

@Injectable()
export class PasswordResetService {
  constructor(
    @Inject(REDIS) private redis: RedisClientType,
    @Inject(EMAIL_SERVICE) private emailClient: ClientProxy,
    private secretService: SecretService,
    private configService: ConfigService,
    private usersService: UsersService,
  ) {}

  private readonly ResetTokenBytes = 32;
  private readonly ResetTokenExpiry = 600; // record TTL (seconds), F8.1
  private readonly ResetTokenCounterExpiry = 3600; // generation counter TTL
  private readonly ResetTokenExpiryMinutes = Math.floor(
    this.ResetTokenExpiry / 60,
  );

  /**
   * Issues a cryptographically random reset token for the email's account and
   * emails a link carrying it.
   *
   * Unknown and archived emails no-op silently.
   */
  async requestReset(email: string) {
    const user = await this.usersService.findActiveUserByEmail(email);
    if (user === null) {
      return;
    }

    const token = this.generateResetToken();
    const recordKey = resetTokenRecordKey(
      token,
      this.secretService.getServerSecret(),
    );
    const counterKey = resetTokenCountKey(email);
    const now = new Date();

    // Atomic bump-and-store: the counter's new generation is stamped onto the
    // record inside the script, so this request implicitly revokes every prior
    // unconsumed token for the account (F8.1.2) — same mechanism as OTPs.
    await this.redis.eval(CREATE_RESET_TOKEN_SCRIPT, {
      keys: [counterKey, recordKey],
      arguments: [
        String(this.ResetTokenCounterExpiry),
        email,
        now.toISOString(),
        String(this.ResetTokenExpiry),
      ],
    });

    const resetLink = this.buildResetLink(token);

    // Emitted once per request with a stable id the email service uses to
    // suppress duplicate sends on broker redelivery.
    this.emailClient.emit('password-reset.email', {
      messageId: randomUUID(),
      recipient: email,
      resetLink,
      subject: 'Reset your password',
      expiry: this.ResetTokenExpiryMinutes,
    });
  }

  /**
   * Redeems a reset token: on success the token's consumption is recorded
   * atomically and the account's password is replaced with a freshly
   * hashed one. Additionally clears the account's lock.
   *
   * Every rejected condition surfaces as the same generic error.
   */
  async confirmReset(token: string, password: string) {
    const recordKey = resetTokenRecordKey(
      token,
      this.secretService.getServerSecret(),
    );

    // The per-account counter key embeds the email, which this request does not
    // carry (only the token does). Peek the bound email out of the record first.
    const record = await this.redis.hGetAll(recordKey);
    if (!record || !('email' in record)) {
      throw new BadRequestException('Invalid or expired reset token.');
    }
    const counterKey = resetTokenCountKey(record.email);

    const result = await this.redis.eval(RESET_PASSWORD_SCRIPT, {
      keys: [recordKey, counterKey],
      arguments: [new Date().toISOString()],
    });

    if (result === 0) {
      throw new BadRequestException('Invalid or expired reset token.');
    }

    const user = await this.usersService.findActiveUserByEmail(record.email);
    if (user === null) {
      throw new BadRequestException('Invalid or expired reset token.');
    }
    await this.usersService.updatePassword(user.id, password);
  }

  private buildResetLink(token: string): string {
    const baseUrl = this.configService.getOrThrow<string>('FRONTEND_BASE_URL');
    const path = this.configService.getOrThrow<string>(
      'FRONTEND_PASSWORD_RESET_PATH',
    );
    return `${baseUrl}${path}?token=${encodeURIComponent(token)}`;
  }

  /**
   * Generates a cryptographically random reset token.
   */
  private generateResetToken() {
    const bytes = randomBytes(this.ResetTokenBytes);
    return bytes.toString('base64url');
  }
}
