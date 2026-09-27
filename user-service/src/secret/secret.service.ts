import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';

/**
 * Exposes helper methods to lazy-load
 * secrets.
 */
@Injectable()
export class SecretService {
  private serverSecret: string;
  private dbPassword: string;
  private rabbitMqPassword: string;
  private jwtPrivateKey: string;
  private jwtPublicKey: string;

  constructor(private configService: ConfigService) {}

  getServerSecret(): string {
    if (this.serverSecret === undefined) {
      this.serverSecret = this.readSecretFile('SERVER_SECRET_FILE');
    }
    return this.serverSecret;
  }

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

  getJwtPrivateKey(): string {
    if (this.jwtPrivateKey === undefined) {
      this.jwtPrivateKey = this.readSecretFile('JWT_PRIVATE_KEY_FILE');
    }
    return this.jwtPrivateKey;
  }

  getJwtPublicKey(): string {
    if (this.jwtPublicKey === undefined) {
      this.jwtPublicKey = this.readSecretFile('JWT_PUBLIC_KEY_FILE');
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
