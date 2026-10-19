import { randomUUID } from 'node:crypto';
import { FocAuthModule } from '@foc/auth';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { signAccessToken, TEST_USER_ID, testKeys } from '../../test/access-token.js';
import { configureHttp } from '../http/configure-http.js';
import { RoleBlocksController } from './role-blocks.controller.js';
import { RoleBlocksService } from './role-blocks.service.js';

// Real HTTP over the controller; only the service is faked, so no DB.
describe('RoleBlocksController', () => {
  const service = { block: vi.fn(), unblock: vi.fn() };
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [FocAuthModule.register({ publicKey: testKeys.publicKey })],
      controllers: [RoleBlocksController],
      providers: [{ provide: RoleBlocksService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
    url = `${await app.getUrl()}/v1/role-blocks`;
  });
  afterAll(() => app.close());
  beforeEach(() => {
    vi.resetAllMocks();
    service.block.mockResolvedValue({
      ok: true,
      blocked: ['requester'],
      expiresAt: new Date('2030-01-01T00:00:00Z'),
    });
  });

  const call = async (method: string, body: unknown, token?: string) =>
    fetch(url, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token && { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(body),
    });
  const self = { userId: TEST_USER_ID, roles: ['requester'] };

  it('rejects a caller without a token', async () => {
    expect((await call('POST', self)).status).toBe(401);
  });

  it('lets a user block their own role', async () => {
    const res = await call('POST', self, await signAccessToken());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      blocked: ['requester'],
      expiresAt: '2030-01-01T00:00:00.000Z',
    });
  });

  it('lets an admin block another user, and refuses a non-admin doing so', async () => {
    const other = { userId: randomUUID(), roles: ['courier'] };
    expect((await call('POST', other, await signAccessToken())).status).toBe(403);
    expect((await call('POST', other, await signAccessToken({ isAdmin: true }))).status).toBe(200);
  });

  it('collapses duplicate roles', async () => {
    await call('POST', { ...self, roles: ['courier', 'courier'] }, await signAccessToken());
    expect(service.block).toHaveBeenCalledWith(TEST_USER_ID, ['courier']);
  });

  it.each([
    ['empty roles', { ...self, roles: [] }],
    ['unknown role', { ...self, roles: ['admin'] }],
    ['missing roles', { userId: TEST_USER_ID }],
    ['malformed user id', { ...self, userId: 'nope' }],
  ])('answers 400 for %s', async (_name, body) => {
    expect((await call('POST', body, await signAccessToken())).status).toBe(400);
  });

  it('answers 409 ROLE_IN_USE naming the roles', async () => {
    service.block.mockResolvedValue({ ok: false, reason: 'ROLE_IN_USE', inUse: ['courier'] });
    const res = await call('POST', self, await signAccessToken());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'ROLE_IN_USE', roles: ['courier'] });
  });

  it('unblocks with the same access rule', async () => {
    const other = { userId: randomUUID(), roles: ['courier'] };
    expect((await call('DELETE', other, await signAccessToken())).status).toBe(403);
    expect((await call('DELETE', self, await signAccessToken())).status).toBe(200);
    expect(service.unblock).toHaveBeenCalledWith(TEST_USER_ID, ['requester']);
  });
});
