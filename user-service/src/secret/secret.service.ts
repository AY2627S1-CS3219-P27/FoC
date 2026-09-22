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

  private readSecretFile(envVar: string): string {
    const path = this.configService.get<string>(envVar);
    if (!path) {
      throw new Error(`Environment variable ${envVar} is not set`);
    }
    // Docker secret files are mounted with a trailing newline.
    return readFileSync(path, 'utf8').trim();
  }
}
