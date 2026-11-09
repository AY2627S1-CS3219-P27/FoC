import { DataSource } from 'typeorm';
import { CreditTransactionQueryService } from '../src/credits/credit-transaction-query.service.js';
import { createDatabaseOptions } from '../src/database/database-options.js';
import {
  CreditAccount,
  CreditTransaction,
} from '../src/database/entities/index.js';

describe('Credit transaction history query', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const otherUserId = '22222222-2222-4222-8222-222222222222';
  const unrelatedUserId = '33333333-3333-4333-8333-333333333333';
  let dataSource: DataSource;
  let service: CreditTransactionQueryService;

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
    service = new CreditTransactionQueryService(
      dataSource.getRepository(CreditAccount),
      dataSource.getRepository(CreditTransaction),
    );
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE TABLE inbox_events, credit_operations, credit_reservations, credit_transactions, outbox_events, credit_allocations, credit_accounts',
    );
    const accounts = dataSource.getRepository(CreditAccount);
    await accounts.save(
      [userId, otherUserId, unrelatedUserId].map((accountUserId) =>
        accounts.create({
          userId: accountUserId,
          creditBalance: 100,
          reservedBalance: 0,
        }),
      ),
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(
        'TRUNCATE TABLE inbox_events, credit_operations, credit_reservations, credit_transactions, outbox_events, credit_allocations, credit_accounts',
      );
      for (let index = 0; index < dataSource.migrations.length; index += 1) {
        await dataSource.undoLastMigration({ transaction: 'all' });
      }
      await dataSource.destroy();
    }
  });

  it('paginates every movement involving the user in stable newest-first order', async () => {
    const transactions = dataSource.getRepository(CreditTransaction);
    const tiedTime = new Date('2026-10-17T08:00:00.000Z');
    await transactions.save([
      transactions.create({
        id: '00000000-0000-4000-8000-000000000001',
        type: 'RESERVATION',
        amount: 10,
        originBalanceType: 'CREDIT_BALANCE',
        destinationBalanceType: 'RESERVED_BALANCE',
        originUserId: userId,
        destinationUserId: userId,
        errandId: '10000000-0000-4000-8000-000000000001',
        createdAt: new Date('2026-10-17T07:00:00.000Z'),
      }),
      transactions.create({
        id: '00000000-0000-4000-8000-000000000002',
        type: 'RESERVATION_ADJUSTMENT',
        amount: 5,
        originBalanceType: 'RESERVED_BALANCE',
        destinationBalanceType: 'CREDIT_BALANCE',
        originUserId: userId,
        destinationUserId: userId,
        errandId: '10000000-0000-4000-8000-000000000001',
        createdAt: new Date('2026-10-17T07:30:00.000Z'),
      }),
      transactions.create({
        id: '00000000-0000-4000-8000-000000000003',
        type: 'TRANSFER',
        amount: 5,
        originBalanceType: 'RESERVED_BALANCE',
        destinationBalanceType: 'CREDIT_BALANCE',
        originUserId: userId,
        destinationUserId: otherUserId,
        errandId: '10000000-0000-4000-8000-000000000001',
        createdAt: tiedTime,
      }),
      transactions.create({
        id: '00000000-0000-4000-8000-000000000004',
        type: 'RELEASE',
        amount: 4,
        originBalanceType: 'RESERVED_BALANCE',
        destinationBalanceType: 'CREDIT_BALANCE',
        originUserId: userId,
        destinationUserId: userId,
        errandId: '10000000-0000-4000-8000-000000000002',
        createdAt: tiedTime,
      }),
      transactions.create({
        id: '00000000-0000-4000-8000-000000000005',
        type: 'TRANSFER',
        amount: 6,
        originBalanceType: 'RESERVED_BALANCE',
        destinationBalanceType: 'CREDIT_BALANCE',
        originUserId: otherUserId,
        destinationUserId: userId,
        errandId: '10000000-0000-4000-8000-000000000003',
        createdAt: tiedTime,
      }),
      transactions.create({
        id: '00000000-0000-4000-8000-000000000006',
        type: 'TRANSFER',
        amount: 7,
        originBalanceType: 'RESERVED_BALANCE',
        destinationBalanceType: 'CREDIT_BALANCE',
        originUserId: otherUserId,
        destinationUserId: unrelatedUserId,
        errandId: '10000000-0000-4000-8000-000000000004',
        createdAt: new Date('2026-10-17T09:00:00.000Z'),
      }),
    ]);

    const first = await service.listHistory(userId, 0, 2);
    const second = await service.listHistory(userId, 2, 2);
    const third = await service.listHistory(userId, 4, 2);

    expect(first.total).toBe(5);
    expect(second.total).toBe(5);
    expect(third.total).toBe(5);
    expect(first.items.map((item) => item.transactionId)).toEqual([
      '00000000-0000-4000-8000-000000000005',
      '00000000-0000-4000-8000-000000000004',
    ]);
    expect(second.items.map((item) => item.transactionId)).toEqual([
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000002',
    ]);
    expect(third.items.map((item) => item.transactionId)).toEqual([
      '00000000-0000-4000-8000-000000000001',
    ]);
    expect(
      new Set(
        [...first.items, ...second.items, ...third.items].map(
          (item) => item.transactionId,
        ),
      ).size,
    ).toBe(5);

    const maximumPage = await service.listHistory(userId, 0, 1000);
    expect(maximumPage.items).toHaveLength(5);
    expect(new Set(maximumPage.items.map((item) => item.type))).toEqual(
      new Set(['RESERVATION', 'RESERVATION_ADJUSTMENT', 'TRANSFER', 'RELEASE']),
    );
  });
});
