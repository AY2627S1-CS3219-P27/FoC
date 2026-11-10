import { BadGatewayException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { Role } from '@foc/contracts';
import { OrderServiceClient } from './order-service.client.js';

const DEFAULT_BASE_URL = 'http://order-service:3000';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const ACCESS_TOKEN = 'test-access-token';

describe('OrderServiceClient', () => {
  let client: OrderServiceClient;
  let baseUrl: string;
  let fetchMock: ReturnType<typeof vi.fn>;
  let loggerError: ReturnType<typeof vi.spyOn>;
  let loggerWarn: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    baseUrl = DEFAULT_BASE_URL;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    // Keep the expected failure-path logs out of the test output while still
    // letting a test assert that the client logged.
    loggerError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    loggerWarn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderServiceClient,
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => baseUrl },
        },
      ],
    }).compile();

    client = module.get(OrderServiceClient);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('blockRoles', () => {
    it('posts the roles with the acting token and reports success', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

      await expect(
        client.blockRoles(
          USER_ID,
          [Role.Requester, Role.Courier],
          ACCESS_TOKEN,
        ),
      ).resolves.toBe(true);

      expect(fetchMock).toHaveBeenCalledWith(
        `${DEFAULT_BASE_URL}/v1/role-blocks`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${ACCESS_TOKEN}`,
          },
          body: JSON.stringify({
            userId: USER_ID,
            roles: [Role.Requester, Role.Courier],
          }),
          signal: expect.any(AbortSignal),
        },
      );
    });

    it('tolerates a trailing slash on the configured base URL', async () => {
      baseUrl = `${DEFAULT_BASE_URL}/`;
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

      await client.blockRoles(USER_ID, [Role.Requester], ACCESS_TOKEN);

      expect(fetchMock).toHaveBeenCalledWith(
        `${DEFAULT_BASE_URL}/v1/role-blocks`,
        expect.anything(),
      );
    });

    it('reports false when a role is still in use', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ code: 'ROLE_IN_USE' }), { status: 409 }),
      );

      await expect(
        client.blockRoles(USER_ID, [Role.Courier], ACCESS_TOKEN),
      ).resolves.toBe(false);

      // A role in use is an expected answer, not a failure.
      expect(loggerError).not.toHaveBeenCalled();
    });

    it('maps an unexpected rejection to a gateway error', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 500 }));

      await expect(
        client.blockRoles(USER_ID, [Role.Courier], ACCESS_TOKEN),
      ).rejects.toThrow(BadGatewayException);
      expect(loggerError).toHaveBeenCalled();
    });

    it('lifts any block that landed when order-service rejects the block', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response(null, { status: 500 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }));

      await expect(
        client.blockRoles(USER_ID, [Role.Courier], ACCESS_TOKEN),
      ).rejects.toThrow(BadGatewayException);

      // The caller aborts the change, so a block committed before the 5xx
      // must not be left standing.
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenLastCalledWith(
        `${DEFAULT_BASE_URL}/v1/role-blocks`,
        expect.objectContaining({
          method: 'DELETE',
          body: JSON.stringify({ userId: USER_ID, roles: [Role.Courier] }),
        }),
      );
    });

    it('maps an unreachable order-service to a gateway error', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));

      await expect(
        client.blockRoles(USER_ID, [Role.Courier], ACCESS_TOKEN),
      ).rejects.toThrow(BadGatewayException);
      expect(loggerError).toHaveBeenCalled();
    });

    it('maps a timeout to a gateway error', async () => {
      fetchMock.mockRejectedValue(
        new DOMException(
          'The operation was aborted due to timeout',
          'TimeoutError',
        ),
      );

      await expect(
        client.blockRoles(USER_ID, [Role.Courier], ACCESS_TOKEN),
      ).rejects.toThrow(BadGatewayException);
    });

    it('compensates a timed-out block, which order-service may still have applied', async () => {
      fetchMock
        .mockRejectedValueOnce(
          new DOMException(
            'The operation was aborted due to timeout',
            'TimeoutError',
          ),
        )
        .mockResolvedValueOnce(new Response(null, { status: 200 }));

      await expect(
        client.blockRoles(USER_ID, [Role.Courier], ACCESS_TOKEN),
      ).rejects.toThrow(BadGatewayException);

      // A client-side abort does not cancel the request server-side, so the
      // block may exist; the compensating delete runs before the 502.
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenLastCalledWith(
        `${DEFAULT_BASE_URL}/v1/role-blocks`,
        expect.objectContaining({
          method: 'DELETE',
          body: JSON.stringify({ userId: USER_ID, roles: [Role.Courier] }),
        }),
      );
    });
  });

  describe('unblockRoles', () => {
    it('deletes the blocks with the acting token', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

      await expect(
        client.unblockRoles(USER_ID, [Role.Requester], ACCESS_TOKEN),
      ).resolves.toBe(true);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        `${DEFAULT_BASE_URL}/v1/role-blocks`,
        {
          method: 'DELETE',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${ACCESS_TOKEN}`,
          },
          body: JSON.stringify({ userId: USER_ID, roles: [Role.Requester] }),
          signal: expect.any(AbortSignal),
        },
      );
      expect(loggerWarn).not.toHaveBeenCalled();
    });

    it('retries once, since the delete is idempotent', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response(null, { status: 503 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }));

      await expect(
        client.unblockRoles(USER_ID, [Role.Requester], ACCESS_TOKEN),
      ).resolves.toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(loggerWarn).toHaveBeenCalledTimes(1);
    });

    it('reports failure instead of throwing, since the block expires on its own', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 503 }));

      await expect(
        client.unblockRoles(USER_ID, [Role.Requester], ACCESS_TOKEN),
      ).resolves.toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(loggerWarn).toHaveBeenCalledTimes(2);
    });

    it('reports failure without throwing when order-service is unreachable', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));

      await expect(
        client.unblockRoles(USER_ID, [Role.Requester], ACCESS_TOKEN),
      ).resolves.toBe(false);
      expect(loggerWarn).toHaveBeenCalledTimes(2);
    });
  });
});
