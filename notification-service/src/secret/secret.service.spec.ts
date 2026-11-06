import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SecretService } from './secret.service.js';
import { readFileSync } from 'node:fs';

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  readFileSync: vi.fn(),
}));

const DB_PASSWORD_VAR = 'DB_PASSWORD_FILE';
const RABBITMQ_PASSWORD_VAR = 'RABBITMQ_PASSWORD_FILE';
const JWT_PUBLIC_KEY_VAR = 'JWT_PUBLIC_KEY_FILE';

describe('SecretService', () => {
  let service: SecretService;

  beforeEach(async () => {
    process.env[DB_PASSWORD_VAR] = '/run/secrets/notification_db_password';
    process.env[RABBITMQ_PASSWORD_VAR] =
      '/run/secrets/rabbitmq_notification_password';
    process.env[JWT_PUBLIC_KEY_VAR] =
      '/run/secrets/jwt_public_key_notification_service';
    vi.mocked(readFileSync).mockReset();
    vi.mocked(readFileSync).mockImplementation((path: unknown) => {
      const file = String(path);
      if (file.includes('rabbitmq')) return 'rabbit-secret\n';
      if (file.includes('jwt')) return 'public-key\n';
      return 'db-secret\n';
    });

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
    service = module.get(SecretService);
  });

  it('trims the trailing newline off docker secret files', () => {
    expect(service.getDbPassword()).toBe('db-secret');
  });

  it('caches each secret after the first read', () => {
    service.getDbPassword();
    service.getDbPassword();
    expect(vi.mocked(readFileSync)).toHaveBeenCalledTimes(1);
  });

  it('reads the broker credential from its own file', () => {
    expect(service.getRabbitMqPassword()).toBe('rabbit-secret');
  });

  it('throws a clear error when the env var is missing', () => {
    delete process.env[RABBITMQ_PASSWORD_VAR];
    expect(() => service.getRabbitMqPassword()).toThrow(
      'RABBITMQ_PASSWORD_FILE is not set',
    );
  });

  it('reads the token verification key from its own file', () => {
    expect(service.getJwtPublicKey()).toBe('public-key');
  });

  it('rejects an empty token verification key', () => {
    vi.mocked(readFileSync).mockReturnValue('\n');
    expect(() => service.getJwtPublicKey()).toThrow(
      'JWT public key file is empty',
    );
  });
});
