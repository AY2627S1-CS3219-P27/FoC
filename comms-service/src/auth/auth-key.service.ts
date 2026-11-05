import { readFileSync } from 'node:fs';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';

@Injectable()
export class AuthKeyService {
  private publicKey?: string;

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  getJwtPublicKey(): string {
    if (this.publicKey !== undefined) return this.publicKey;
    const path = this.config.get('JWT_PUBLIC_KEY_FILE', { infer: true });
    const publicKey = readFileSync(path, 'utf8').trim();
    if (publicKey.length === 0) throw new Error('JWT public key file is empty');
    this.publicKey = publicKey;
    return publicKey;
  }
}
