import { randomUUID } from 'node:crypto';
import { FocAuthModule } from '@foc/auth';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { signAccessToken, TEST_USER_ID, testKeys } from '../../test/access-token.js';
import { configureHttp } from '../http/configure-http.js';
import { LifecycleService } from '../lifecycle/lifecycle.service.js';
import { ErrandsModule } from './errands.module.js';

// Real HTTP over ErrandsModule; only LifecycleService is faked, so no DB.
describe('ErrandsController', () => {
  const lifecycle = {
    create: vi.fn(),
    transition: vi.fn(),
    currentStatus: vi.fn(),
    lastEvent: vi.fn(),
  };
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [FocAuthModule.register({ publicKey: testKeys.publicKey }), ErrandsModule],
    })
      .overrideProvider(LifecycleService)
      .useValue(lifecycle)
      .compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
    base = `${await app.getUrl()}/v1/errands`;
  });
  afterAll(() => app.close());
  beforeEach(() => vi.resetAllMocks());

  const validBody = {
    supplierId: randomUUID(),
    deliveryLocation: 'COM2',
    rewardCredits: 5,
  };
  const post = async (body: unknown, token?: string) =>
    fetch(base, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token && { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(body),
    });

  describe('POST /v1/errands', () => {
    it('rejects a caller without a token', async () => {
      expect((await post(validBody)).status).toBe(401);
      expect(lifecycle.create).not.toHaveBeenCalled();
    });

    it('creates the errand for the caller', async () => {
      lifecycle.create.mockResolvedValue({ ok: true, errandId: 'e1' });

      const res = await post(validBody, await signAccessToken());

      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ errandId: 'e1' });
      expect(lifecycle.create).toHaveBeenCalledWith({
        ...validBody,
        requesterId: TEST_USER_ID,
      });
    });

    it('ignores a requesterId in the body: the requester is always the caller', async () => {
      lifecycle.create.mockResolvedValue({ ok: true, errandId: 'e1' });

      await post({ ...validBody, requesterId: randomUUID() }, await signAccessToken());

      expect(lifecycle.create.mock.calls[0][0].requesterId).toBe(TEST_USER_ID);
    });

    it.each([
      ['a missing supplierId', { ...validBody, supplierId: undefined }],
      ['a non-uuid supplierId', { ...validBody, supplierId: 'abc' }],
      ['a blank deliveryLocation', { ...validBody, deliveryLocation: '   ' }],
      ['zero rewardCredits', { ...validBody, rewardCredits: 0 }],
      ['a string rewardCredits', { ...validBody, rewardCredits: '5' }],
      ['too short an expiry', { ...validBody, expiryDurationMinutes: 5 }],
    ])('rejects %s before reaching the lifecycle', async (_, body) => {
      expect((await post(body, await signAccessToken())).status).toBe(400);
      expect(lifecycle.create).not.toHaveBeenCalled();
    });

    it('maps a lifecycle failure to its HTTP error', async () => {
      lifecycle.create.mockResolvedValue({ ok: false, reason: 'INVALID_FIELDS' });

      const res = await post(validBody, await signAccessToken());

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'INVALID_FIELDS' });
    });
  });

  describe('POST /v1/errands/:id/<action>', () => {
    const errandId = randomUUID();
    const act = async (id: string, action: string, body?: unknown, token?: string) =>
      fetch(`${base}/${id}/${action}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token && { authorization: `Bearer ${token}` }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const actor = { kind: 'user', id: TEST_USER_ID };

    // action, request body, what transition() must receive
    it.each([
      ['accept', undefined, { expected: 'Open', to: 'Accepted', set: { courierId: TEST_USER_ID } }],
      ['pickup', undefined, { expected: 'Accepted', to: 'Picked Up', set: { pickedUpAt: expect.any(Date) } }],
      ['deliver', undefined, { expected: 'Picked Up', to: 'Delivered', set: { deliveredAt: expect.any(Date) } }],
      ['confirm', undefined, { expected: 'Delivered', to: 'Transferring-Credit' }],
      ['incomplete', undefined, { expected: 'Delivered', to: 'Incomplete' }],
      ['withdraw', { reason: 'bike broke down' }, { expected: 'Accepted', to: 'Open', payload: { reason: 'bike broke down' } }],
      ['adjust', { newAmount: 9 }, { expected: 'Open', to: 'Adjusting-Credit', payload: { newAmount: 9 } }],
    ])('%s runs its edge as the caller and answers 200', async (action, body, edge) => {
      lifecycle.transition.mockResolvedValue({ ok: true, sequenceNumber: 2 });

      const res = await act(errandId, action, body, await signAccessToken());

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ sequenceNumber: 2 });
      // Exact match: no extra set/payload keys sneak in from the body.
      expect(lifecycle.transition).toHaveBeenCalledWith({ errandId, actor, ...edge });
    });

    it('rejects a caller without a token', async () => {
      expect((await act(errandId, 'accept')).status).toBe(401);
      expect(lifecycle.transition).not.toHaveBeenCalled();
    });

    it('rejects an errand id that is not a uuid, before reaching the lifecycle', async () => {
      expect((await act('abc', 'accept', undefined, await signAccessToken())).status).toBe(400);
      expect(lifecycle.transition).not.toHaveBeenCalled();
    });

    it.each([
      ['withdraw with no reason', 'withdraw', {}],
      ['withdraw with a blank reason', 'withdraw', { reason: '   ' }],
      ['withdraw with a reason over 500 characters', 'withdraw', { reason: 'x'.repeat(501) }],
      ['adjust with no amount', 'adjust', {}],
      ['adjust with a zero amount', 'adjust', { newAmount: 0 }],
      ['adjust with a string amount', 'adjust', { newAmount: '9' }],
    ])('rejects %s before reaching the lifecycle', async (_, action, body) => {
      expect((await act(errandId, action, body, await signAccessToken())).status).toBe(400);
      expect(lifecycle.transition).not.toHaveBeenCalled();
    });

    it('takes a reason of exactly 500 characters', async () => {
      lifecycle.transition.mockResolvedValue({ ok: true, sequenceNumber: 2 });
      const res = await act(errandId, 'withdraw', { reason: 'x'.repeat(500) }, await signAccessToken());
      expect(res.status).toBe(200);
    });

    it.each([
      ['FORBIDDEN', 403],
      ['NOT_FOUND', 404],
      ['COURIER_BUSY', 409],
    ])('maps %s from the lifecycle to %i', async (reason, status) => {
      lifecycle.transition.mockResolvedValue({ ok: false, reason });

      const res = await act(errandId, 'accept', undefined, await signAccessToken());

      expect(res.status).toBe(status);
      expect(await res.json()).toMatchObject({ code: reason });
    });

    describe('cancel', () => {
      it('answers 404 for an unknown errand, without a transition', async () => {
        lifecycle.currentStatus.mockResolvedValue(undefined);

        const res = await act(errandId, 'cancel', undefined, await signAccessToken());

        expect(res.status).toBe(404);
        expect(await res.json()).toMatchObject({ code: 'NOT_FOUND' });
        expect(lifecycle.currentStatus).toHaveBeenCalledWith(errandId);
        expect(lifecycle.transition).not.toHaveBeenCalled();
      });

      it('rejects an errand id that is not a uuid, before reading anything', async () => {
        expect((await act('abc', 'cancel', undefined, await signAccessToken())).status).toBe(400);
        expect(lifecycle.currentStatus).not.toHaveBeenCalled();
      });

      describe('when the errand is already Cancelled', () => {
        const cancelledFrom = (fromStatus: string | null) => {
          lifecycle.currentStatus.mockResolvedValue('Cancelled');
          lifecycle.lastEvent.mockResolvedValue({
            fromStatus,
            toStatus: 'Cancelled',
            type: 'ErrandCancelled',
          });
        };

        it.each(['Open', 'Accepted'])(
          'aims at the %s edge it was cancelled from, so a retry replays',
          async (fromStatus) => {
            cancelledFrom(fromStatus);
            lifecycle.transition.mockResolvedValue({ ok: true, sequenceNumber: 2, replayed: true });

            const res = await act(errandId, 'cancel', undefined, await signAccessToken());

            expect(res.status).toBe(200);
            expect(lifecycle.transition).toHaveBeenCalledWith({
              errandId,
              expected: fromStatus,
              to: 'Cancelled',
              actor,
              set: { cancellationReason: 'REQUESTER_CANCELLED' },
            });
          },
        );

        it('passes on 409 when someone else cancelled it (transition says STATE_MISMATCH)', async () => {
          cancelledFrom('Open');
          lifecycle.transition.mockResolvedValue({
            ok: false,
            reason: 'STATE_MISMATCH',
            currentStatus: 'Cancelled',
          });

          const res = await act(errandId, 'cancel', undefined, await signAccessToken());

          expect(res.status).toBe(409);
          expect(await res.json()).toMatchObject({ code: 'STATE_MISMATCH' });
        });

        it('answers NOT_CANCELLABLE when it was cancelled from a status a requester cannot cancel', async () => {
          cancelledFrom('Picked Up');

          const res = await act(errandId, 'cancel', undefined, await signAccessToken());

          expect(res.status).toBe(409);
          expect(await res.json()).toMatchObject({ code: 'NOT_CANCELLABLE' });
          expect(lifecycle.transition).not.toHaveBeenCalled();
        });
      });

      it('does not read the last event for an errand that is not Cancelled', async () => {
        lifecycle.currentStatus.mockResolvedValue('Open');
        lifecycle.transition.mockResolvedValue({ ok: true, sequenceNumber: 2 });

        await act(errandId, 'cancel', undefined, await signAccessToken());

        expect(lifecycle.lastEvent).not.toHaveBeenCalled();
        expect(lifecycle.transition.mock.calls[0][0].expected).toBe('Open');
      });
    });
  });
});
