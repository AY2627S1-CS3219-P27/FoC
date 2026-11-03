import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  envs: {
    PORT: 3000,
    LOG_LEVEL: 'silent',
    RABBITMQ_USER: 'notification-service',
    RABBITMQ_HOST: 'rabbitmq',
    RABBITMQ_PORT: 5672,
    RABBITMQ_VHOST: '/foc',
    RABBITMQ_PASSWORD_FILE: '/run/secrets/rabbitmq_notification_password',
    DB_HOST: 'notification-db',
    DB_PORT: 5432,
    DB_USERNAME: 'notification_service',
    DB_DATABASE: 'notification_service',
    DB_PASSWORD_FILE: '/run/secrets/notification_db_password',
  },
}));

vi.mock('../utils/envs.ts', () => ({ envs: mocks.envs }));

import { buildServer } from './server.ts';

describe('http surface', () => {
  it('reports healthy on GET /health', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });
});
