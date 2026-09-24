import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SecretService } from './secret.service.js';
import { readFileSync } from 'node:fs';

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  readFileSync: vi.fn(),
}));

const SERVER_SECRET_VAR = 'SERVER_SECRET_FILE';
const DB_PASSWORD_VAR = 'DB_PASSWORD_FILE';

describe('SecretService', () => {
  let service: SecretService;

  beforeEach(async () => {
    process.env[SERVER_SECRET_VAR] = '/run/secrets/server_secret';
    process.env[DB_PASSWORD_VAR] = '/run/secrets/db_password';
    vi.mocked(readFileSync).mockReset();
    vi.mocked(readFileSync).mockReturnValue('secret-value\n');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecretService,
        // The env vars above feed straight into the config values the
        // service reads, keeping the test body in terms of process.env.
        {
          provide: ConfigService,
          useValue: { get: (key: string) => process.env[key] },
        },
      ],
    }).compile();

    service = module.get<SecretService>(SecretService);
  });

  afterEach(() => {
    delete process.env[SERVER_SECRET_VAR];
    delete process.env[DB_PASSWORD_VAR];
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('reads the server secret from the SERVER_SECRET_FILE path and trims it', () => {
    expect(service.getServerSecret()).toBe('secret-value');

    expect(vi.mocked(readFileSync)).toHaveBeenCalledWith(
      '/run/secrets/server_secret',
      'utf8',
    );
  });

  it('reads the db password from the DB_PASSWORD_FILE path and trims it', () => {
    expect(service.getDbPassword()).toBe('secret-value');

    expect(vi.mocked(readFileSync)).toHaveBeenCalledWith(
      '/run/secrets/db_password',
      'utf8',
    );
  });

  it('throws when a secret env var is missing, without touching the filesystem', () => {
    delete process.env[SERVER_SECRET_VAR];

    expect(() => service.getServerSecret()).toThrow(
      `Environment variable ${SERVER_SECRET_VAR} is not set`,
    );
    expect(vi.mocked(readFileSync)).not.toHaveBeenCalled();
  });

  it('reads each secret file only once', () => {
    service.getServerSecret();
    service.getServerSecret();
    service.getServerSecret();

    expect(vi.mocked(readFileSync)).toHaveBeenCalledTimes(1);
  });

  it('caches the two secrets independently', () => {
    service.getServerSecret();
    service.getServerSecret();
    service.getDbPassword();
    service.getDbPassword();

    expect(vi.mocked(readFileSync)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(readFileSync)).toHaveBeenCalledWith(
      '/run/secrets/server_secret',
      'utf8',
    );
    expect(vi.mocked(readFileSync)).toHaveBeenCalledWith(
      '/run/secrets/db_password',
      'utf8',
    );
  });
});
