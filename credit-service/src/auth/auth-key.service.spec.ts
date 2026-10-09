import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';
import { AuthKeyService } from './auth-key.service.js';

describe('AuthKeyService', () => {
  let directory: string;
  let publicKeyPath: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'credit-auth-key-'));
    publicKeyPath = join(directory, 'jwt-public.pem');
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  const createService = () =>
    new AuthKeyService(
      new ConfigService<EnvironmentVariables, true>({
        JWT_PUBLIC_KEY_FILE: publicKeyPath,
      }),
    );

  it('loads, trims, and caches the mounted public key', () => {
    writeFileSync(publicKeyPath, '  public-key-pem\n', 'utf8');
    const service = createService();

    expect(service.getJwtPublicKey()).toBe('public-key-pem');

    writeFileSync(publicKeyPath, 'replacement', 'utf8');
    expect(service.getJwtPublicKey()).toBe('public-key-pem');
  });

  it('rejects an empty public key file', () => {
    writeFileSync(publicKeyPath, ' \n', 'utf8');

    expect(() => createService().getJwtPublicKey()).toThrow(
      'JWT public key file is empty',
    );
  });
});
