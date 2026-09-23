import { OTP_PREFIX } from '../constants.js';
import { hmacValue } from './hash.js';

const REGISTRATION_TOKEN_PREFIX = 'regtoken';
const REGISTRATION_HASH_LENGTH = 32;
const OTP_HASH_LENGTH = 16;

/**
 * Shared Redis key derivation for OTPs and registration tokens.
 *
 * Both the issuing side (OtpService) and any verifying side (AuthService) call
 * these functions, keyed on the same server secret, so a token's stored record
 * can be looked up by any module without re-implementing the key format. The
 * prefix + HMAC-sha256 digest of the token, truncated to the agreed byte
 * length, is the contract between writer and reader.
 */

export function otpRecordKey(
  email: string,
  otp: string,
  secret: string,
): string {
  return `${OTP_PREFIX}:${hmacValue(`${email}:${otp}`, secret, OTP_HASH_LENGTH)}`;
}

export function registrationTokenRecordKey(
  token: string,
  secret: string,
): string {
  return `${REGISTRATION_TOKEN_PREFIX}:${hmacValue(
    token,
    secret,
    REGISTRATION_HASH_LENGTH,
  )}`;
}
