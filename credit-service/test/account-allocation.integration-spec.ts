import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AccountAllocationService } from '../src/account/account-allocation.service.js';
import type { EnvironmentVariables } from '../src/config/environment.js';
import { createDatabaseOptions } from '../src/database/database-options.js';
import {
  CreditAccount,
  CreditAllocation,
} from '../src/database/entities/index.js';
import { SerializableTransactionRunner } from '../src/database/serializable-transaction.runner.js';

function allocationService(amount: number): AccountAllocationService {
  return new AccountAllocationService(
    new ConfigService<EnvironmentVariables, true>({
      INITIAL_CREDIT_BALANCE: amount,
    }),
  );
}

describe('AccountAllocationService persistence', () => {
  let dataSource: DataSource;
  let transactionRunner: SerializableTransactionRunner;

  beforeAll(async () => {
    dataSource = new DataSource(
      createDatabaseOptions({
        DB_HOST: process.env.DB_HOST!,
        DB_PORT: Number(process.env.DB_PORT),
        DB_USERNAME: process.env.DB_USERNAME!,
        DB_DATABASE: process.env.DB_DATABASE!,
        DB_PASSWORD_FILE: process.env.DB_PASSWORD_FILE!,
      }),
    );
    await dataSource.initialize();
    await dataSource.dropDatabase();
    await dataSource.runMigrations({ transaction: 'all' });
    transactionRunner = new SerializableTransactionRunner(dataSource);
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE TABLE inbox_events, outbox_events, credit_allocations, credit_accounts',
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.undoLastMigration({ transaction: 'all' });
      await dataSource.destroy();
    }
  });

  it('creates one account and allocation with database-generated time', async () => {
    const userId = randomUUID();

    const result = await transactionRunner.run((manager) =>
      allocationService(100).allocate(manager, userId),
    );

    expect(result).toMatchObject({
      userId,
      creditAmountAllocated: 100,
      created: true,
      allocatedAt: expect.any(Date),
    });
    expect(result.allocationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    await expect(
      dataSource.getRepository(CreditAccount).findOneByOrFail({ userId }),
    ).resolves.toMatchObject({ creditBalance: 100, reservedBalance: 0 });
    await expect(
      dataSource
        .getRepository(CreditAllocation)
        .findOneByOrFail({ id: result.allocationId }),
    ).resolves.toMatchObject({ userId, amount: 100 });
  });

  it('returns the original allocation for sequential duplicates', async () => {
    const userId = randomUUID();
    const service = allocationService(100);

    const first = await transactionRunner.run((manager) =>
      service.allocate(manager, userId),
    );
    const duplicate = await transactionRunner.run((manager) =>
      service.allocate(manager, userId),
    );

    expect(duplicate).toEqual({ ...first, created: false });
    expect(
      await dataSource.getRepository(CreditAccount).countBy({ userId }),
    ).toBe(1);
    expect(
      await dataSource.getRepository(CreditAllocation).countBy({ userId }),
    ).toBe(1);
  });

  it('converges concurrent attempts on one allocation', async () => {
    const userId = randomUUID();
    const service = allocationService(100);

    const results = await Promise.all([
      transactionRunner.run((manager) => service.allocate(manager, userId)),
      transactionRunner.run((manager) => service.allocate(manager, userId)),
    ]);

    expect(results.map(({ created }) => created).sort()).toEqual([false, true]);
    expect(new Set(results.map(({ allocationId }) => allocationId)).size).toBe(
      1,
    );
    expect(
      await dataSource.getRepository(CreditAccount).countBy({ userId }),
    ).toBe(1);
    expect(
      await dataSource.getRepository(CreditAllocation).countBy({ userId }),
    ).toBe(1);
  });

  it('keeps the original allocation when configuration changes', async () => {
    const userId = randomUUID();
    const original = await transactionRunner.run((manager) =>
      allocationService(100).allocate(manager, userId),
    );

    const duplicate = await transactionRunner.run((manager) =>
      allocationService(250).allocate(manager, userId),
    );

    expect(duplicate).toEqual({ ...original, created: false });
    await expect(
      dataSource.getRepository(CreditAccount).findOneByOrFail({ userId }),
    ).resolves.toMatchObject({ creditBalance: 100, reservedBalance: 0 });
  });

  it('rolls back the account and allocation after a caller failure', async () => {
    const userId = randomUUID();
    const injectedFailure = new Error('injected failure');

    await expect(
      transactionRunner.run(async (manager) => {
        await allocationService(100).allocate(manager, userId);
        throw injectedFailure;
      }),
    ).rejects.toBe(injectedFailure);

    expect(
      await dataSource.getRepository(CreditAccount).countBy({ userId }),
    ).toBe(0);
    expect(
      await dataSource.getRepository(CreditAllocation).countBy({ userId }),
    ).toBe(0);
  });

  it('keeps allocation records immutable', async () => {
    const userId = randomUUID();
    const allocation = await transactionRunner.run((manager) =>
      allocationService(100).allocate(manager, userId),
    );

    await expect(
      dataSource.query(
        'UPDATE credit_allocations SET amount = 200 WHERE id = $1',
        [allocation.allocationId],
      ),
    ).rejects.toThrow('credit_allocations is append-only');
    await expect(
      dataSource.query('DELETE FROM credit_allocations WHERE id = $1', [
        allocation.allocationId,
      ]),
    ).rejects.toThrow('credit_allocations is append-only');
  });
});
