import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import type { EnvironmentVariables } from '../config/environment.js';

/** Loads the public verification key without placing key material in env. */
@Injectable()
export class AuthKeyService {
  private jwtPublicKey?: string;

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  getJwtPublicKey(): string {
    if (this.jwtPublicKey !== undefined) {
      return this.jwtPublicKey;
    }

    const path = this.config.get('JWT_PUBLIC_KEY_FILE', { infer: true });
    const publicKey = readFileSync(path, 'utf8').trim();
    if (publicKey.length === 0) {
      throw new Error('JWT public key file is empty');
    }

    this.jwtPublicKey = publicKey;
    return publicKey;
  }
}
