import { Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';

function readSecretFile(envVar: string): string {
  const path = process.env[envVar];
  if (!path) {
    throw new Error(`Environment variable ${envVar} is not set`);
  }
  // Docker secret files are mounted with a trailing newline.
  return readFileSync(path, 'utf8').trim();
}

/**
 * Exposes helper methods to lazy-load
 * secrets.
 */
@Injectable()
export class SecretService {
  private serverSecret: string;
  private dbPassword: string;

  getServerSecret(): string {
    if (this.serverSecret === undefined) {
      this.serverSecret = readSecretFile('SERVER_SECRET_FILE');
    }
    return this.serverSecret;
  }

  getDbPassword(): string {
    if (this.dbPassword === undefined) {
      this.dbPassword = readSecretFile('DB_PASSWORD_FILE');
    }
    return this.dbPassword;
  }
}
