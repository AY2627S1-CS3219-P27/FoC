import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { createTestDb } from '../../test/db.js';
import { DB } from '../db/db.module.js';
import { LifecycleModule } from './lifecycle.module.js';
import { LifecycleService } from './lifecycle.service.js';
import { SYSTEM } from './transition.js';

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

it('creates and transitions through the injected service', async () => {
  const mod = await Test.createTestingModule({ imports: [LifecycleModule] })
    .useMocker((token) => (token === DB ? t.db : undefined))
    .compile();
  const svc = mod.get(LifecycleService);

  const created = await svc.create({
    requesterId: randomUUID(),
    supplierId: randomUUID(),
    deliveryLocation: 'COM2',
    rewardCredits: 5,
    expiryDurationMinutes: 60,
    collectionItems: 'bubble tea',
  });
  if (!created.ok) throw new Error('expected ok');

  expect(
    await svc.transition({
      actor: SYSTEM, errandId: created.errandId,
      expected: 'Pending-Supplier',
      to: 'Reserving-Credit',
    }),
  ).toMatchObject({ ok: true, sequenceNumber: 2 });
});

it('reads the current status, and undefined for an unknown errand', async () => {
  const mod = await Test.createTestingModule({ imports: [LifecycleModule] })
    .useMocker((token) => (token === DB ? t.db : undefined))
    .compile();
  const svc = mod.get(LifecycleService);

  const created = await svc.create({
    requesterId: randomUUID(),
    supplierId: randomUUID(),
    deliveryLocation: 'COM2',
    rewardCredits: 5,
    expiryDurationMinutes: 60,
    collectionItems: 'bubble tea',
  });
  if (!created.ok) throw new Error('expected ok');

  expect(await svc.currentStatus(created.errandId)).toBe('Pending-Supplier');
  expect(await svc.currentStatus(randomUUID())).toBeUndefined();
});

it('reads the latest event, and undefined for an unknown errand', async () => {
  const mod = await Test.createTestingModule({ imports: [LifecycleModule] })
    .useMocker((token) => (token === DB ? t.db : undefined))
    .compile();
  const svc = mod.get(LifecycleService);

  const created = await svc.create({
    requesterId: randomUUID(),
    supplierId: randomUUID(),
    deliveryLocation: 'COM2',
    rewardCredits: 5,
    expiryDurationMinutes: 60,
    collectionItems: 'bubble tea',
  });
  if (!created.ok) throw new Error('expected ok');
  expect(await svc.lastEvent(created.errandId)).toEqual({
    fromStatus: null,
    toStatus: 'Pending-Supplier',
    type: 'ErrandCreated',
  });

  await svc.transition({
    actor: SYSTEM,
    errandId: created.errandId,
    expected: 'Pending-Supplier',
    to: 'Cancelled',
    set: { cancellationReason: 'SUPPLIER_UNAVAILABLE' },
  });
  expect(await svc.lastEvent(created.errandId)).toEqual({
    fromStatus: 'Pending-Supplier',
    toStatus: 'Cancelled',
    type: 'ErrandCancelled',
  });

  expect(await svc.lastEvent(randomUUID())).toBeUndefined();
});
