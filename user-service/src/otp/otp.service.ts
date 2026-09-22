import { Injectable, Inject } from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { hashValue } from '../common/hash/hash.js';
import { REDIS } from '../redis/redis.provider.js';
import { SecretService } from '../secret/secret.service.js';
import type { Redis } from 'ioredis';
import { ClientProxy } from '@nestjs/microservices';
import { EMAIL_SERVICE } from '../broker/broker.module.js';

const OTP_PREFIX = 'otp';

// Bumps the generation counter and writes the OTP record as one atomic unit.
// The INCR's result is used inside the script to stamp the record with the
// generation, which a client-side MULTI cannot do (queued command arguments
// are fixed before EXEC; results are only available after). The counter TTL
// is comfortably longer than the record TTL so the counter is guaranteed
// alive for the lifetime of any pending record.
//
// KEYS[1] = generation counter key
// KEYS[2] = otp record key
// ARGV[1] = counter TTL (seconds)
// ARGV[2] = issuedAt ISO string
// ARGV[3] = record TTL (seconds)
export const CREATE_OTP_SCRIPT = `
  local count = redis.call('INCR', KEYS[1])
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  redis.call('HSET', KEYS[2], 'count', count, 'issuedAt', ARGV[2])
  redis.call('EXPIRE', KEYS[2], ARGV[3])
  return count
`;

// Validates an OTP against F1.4 and consumes it atomically if valid.
//
// Every rejected condition (unknown/expired, revoked, already consumed)
// collapses to a single `0`, so callers cannot tell which F1.4 check failed.
// On success, consumption is stamped before the script returns, so the
// associated action only runs after the OTP is recorded as consumed.
//
// Validity period is implicit: records carry a TTL (set at issue time), so a
// live record exists only while it is within its validity window.
//
// KEYS[1] = otp record key
// KEYS[2] = generation counter key
// ARGV[1] = consumedAt ISO string
export const VALIDATE_OTP_SCRIPT = `
  local record = redis.call('HGETALL', KEYS[1])
  if #record == 0 then
    return 0
  end
  local fields = {}
  for i = 1, #record, 2 do
    fields[record[i]] = record[i + 1]
  end
  if fields['consumedAt'] ~= nil then
    return 0
  end
  local counter = redis.call('GET', KEYS[2])
  if not counter or tonumber(counter) ~= tonumber(fields['count']) then
    return 0
  end
  redis.call('HSET', KEYS[1], 'consumedAt', ARGV[1])
  return 1
`;

@Injectable()
export class OtpService {
  constructor(
    @Inject(REDIS) private redis: Redis,
    @Inject(EMAIL_SERVICE) private emailClient: ClientProxy,
    private secretService: SecretService,
  ) {}

  private readonly OtpLength = 6;
  private readonly OtpExpiry = 600; // record TTL (seconds)
  private readonly OtpExpiryMinutes = Math.floor(this.OtpExpiry / 60);
  private readonly TimerExpiry = 3600; // generation counter TTL (seconds)
  private readonly OtpHashLen = 16;

  async createOtpRequest(email: string) {
    const otp = this.generateOtp();

    const recordKey = await this.recordKey(email, otp);
    const counterKey = `${OTP_PREFIX}:count:${email}`;

    // Atomic bump-and-store. Older OTPs are implicitly revoked by stamping
    // the new generation onto the record; validation later matches an OTP's
    // generation against the counter.
    await this.redis.eval(
      CREATE_OTP_SCRIPT,
      2,
      counterKey,
      recordKey,
      this.TimerExpiry,
      new Date().toISOString(),
      this.OtpExpiry,
    );

    // Emitted once per request with a stable id the email service uses to
    // suppress duplicate sends on broker redelivery.
    this.emailClient.emit('otp.email', {
      messageId: randomUUID(),
      recipient: email,
      otp: otp,
      subject: 'Your OTP is here',
      expiry: this.OtpExpiryMinutes,
    });

    return;
  }

  /**
   * Validates an OTP against F1.4 and, on success, atomically records its
   * consumption before this method resolves. Returns false for every rejected
   * condition (no match / expired, revoked, already consumed) alike.
   */
  async validateOtp(email: string, otp: string): Promise<boolean> {
    const recordKey = await this.recordKey(email, otp);
    const counterKey = `${OTP_PREFIX}:count:${email}`;

    const result = await this.redis.eval(
      VALIDATE_OTP_SCRIPT,
      2,
      recordKey,
      counterKey,
      new Date().toISOString(),
    );

    return result === 1;
  }

  /**
   * Generates and returns a key to store and validate OTPs with
   */
  private async recordKey(email: string, otp: string): Promise<string> {
    const salt = this.secretService.getServerSecret();
    const key = await hashValue(`${email}:${otp}`, salt, this.OtpHashLen);
    return `${OTP_PREFIX}:${key}`;
  }

  /**
   * Generates an OTP using node:crypto library
   */
  generateOtp() {
    const bytes = randomBytes(this.OtpLength);

    // Convert bytes to string using the base64url encoding.
    // This results in a possible character set of [A-Za-z0-9_-]

    // The amount of base64url characters will be more than the generated bytes,
    // hence we slice.
    return bytes.toString('base64url').slice(0, this.OtpLength);
  }
}
