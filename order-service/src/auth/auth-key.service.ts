import { readFileSync } from 'node:fs';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Reads user-service's public key from the mounted secret file, so key
// material never sits in an env var. A provider rather than an inline read so
// tests can override it with a generated key instead of writing a file.
@Injectable()
export class AuthKeyService {
  private publicKey?: string;

  constructor(private readonly config: ConfigService) {}

  getJwtPublicKey(): string {
    if (this.publicKey !== undefined) return this.publicKey;
    const key = readFileSync(
      this.config.getOrThrow<string>('JWT_PUBLIC_KEY_FILE'),
      'utf8',
    ).trim();
    // An empty key would not fail at boot: every request would just be a 401.
    if (key.length === 0) throw new Error('JWT public key file is empty');
    this.publicKey = key;
    return key;
  }
}
