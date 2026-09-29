import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { createTestDb } from '../../test/db.js';
import { DB } from '../db/db.module.js';
import { LifecycleModule } from './lifecycle.module.js';
import { LifecycleService } from './lifecycle.service.js';

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
  });
  if (!created.ok) throw new Error('expected ok');

  expect(
    await svc.transition({
      errandId: created.errandId,
      expected: 'Pending-Supplier',
      to: 'Pending-Credit',
    }),
  ).toMatchObject({ ok: true, sequenceNumber: 2 });
});
