import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';

/**
 * Exposes helper methods to lazy-load
 * secrets.
 */
@Injectable()
export class SecretService {
  private dbPassword: string;
  private rabbitMqPassword: string;
  private jwtPublicKey: string;

  constructor(private configService: ConfigService) {}

  getDbPassword(): string {
    if (this.dbPassword === undefined) {
      this.dbPassword = this.readSecretFile('DB_PASSWORD_FILE');
    }
    return this.dbPassword;
  }

  getRabbitMqPassword(): string {
    if (this.rabbitMqPassword === undefined) {
      this.rabbitMqPassword = this.readSecretFile('RABBITMQ_PASSWORD_FILE');
    }
    return this.rabbitMqPassword;
  }

  /**
   * The user-service RS256 public key used to verify access tokens. An empty
   * key must fail here: it would not fail at boot, every request would just
   * be a 401.
   */
  getJwtPublicKey(): string {
    if (this.jwtPublicKey === undefined) {
      const publicKey = this.readSecretFile('JWT_PUBLIC_KEY_FILE');
      if (publicKey.length === 0) {
        throw new Error('JWT public key file is empty');
      }
      this.jwtPublicKey = publicKey;
    }
    return this.jwtPublicKey;
  }

  private readSecretFile(envVar: string): string {
    const path = this.configService.get<string>(envVar);
    if (!path) {
      throw new Error(`Environment variable ${envVar} is not set`);
    }
    // Docker secret files are mounted with a trailing newline.
    return readFileSync(path, 'utf8').trim();
  }
}
