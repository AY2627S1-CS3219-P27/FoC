import { ConfigService } from '@nestjs/config';
import type { EntityManager, Repository } from 'typeorm';
import type { EnvironmentVariables } from '../config/environment.js';
import { CreditAllocation } from '../database/entities/index.js';
import {
  AccountAllocationInvariantError,
  AccountAllocationService,
  AccountAllocationTransactionRequiredError,
} from './account-allocation.service.js';

function createService(initialCreditBalance: number | undefined = 100) {
  const config = new ConfigService<EnvironmentVariables, true>({
    INITIAL_CREDIT_BALANCE: initialCreditBalance,
  });
  return new AccountAllocationService(config);
}

function activeManager(options: {
  existing?: CreditAllocation | null;
  afterConflict?: CreditAllocation | null;
  accountCreated?: boolean;
  createdAt?: Date;
}) {
  const createdAt = options.createdAt ?? new Date('2026-01-01T00:00:00.000Z');
  const findOneBy = vi
    .fn()
    .mockResolvedValueOnce(options.existing ?? null)
    .mockResolvedValueOnce(options.afterConflict ?? null);
  const repository = {
    findOneBy,
    create: vi.fn((value) => value),
    save: vi.fn(async (value) => ({ ...value, createdAt })),
  } as unknown as Repository<CreditAllocation>;

  const builder = {
    insert: vi.fn(),
    into: vi.fn(),
    values: vi.fn(),
    orIgnore: vi.fn(),
    returning: vi.fn(),
    execute: vi.fn().mockResolvedValue({
      raw: options.accountCreated === false ? [] : [{ user_id: 'inserted' }],
    }),
  };
  builder.insert.mockReturnValue(builder);
  builder.into.mockReturnValue(builder);
  builder.values.mockReturnValue(builder);
  builder.orIgnore.mockReturnValue(builder);
  builder.returning.mockReturnValue(builder);

  const manager = {
    queryRunner: { isTransactionActive: true },
    getRepository: vi.fn().mockReturnValue(repository),
    createQueryBuilder: vi.fn().mockReturnValue(builder),
  } as unknown as EntityManager;

  return { manager, repository, builder, findOneBy };
}

describe('AccountAllocationService', () => {
  it('allocates the default 100 credits to a new account', async () => {
    const { manager, repository, builder } = activeManager({
      accountCreated: true,
    });

    const result = await createService().allocate(
      manager,
      '6af06251-1bdf-4808-833a-3e04f4746096',
    );

    expect(builder.values).toHaveBeenCalledWith({
      userId: '6af06251-1bdf-4808-833a-3e04f4746096',
      creditBalance: 100,
      reservedBalance: 0,
    });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: '6af06251-1bdf-4808-833a-3e04f4746096',
        amount: 100,
        id: expect.any(String),
      }),
    );
    expect(result).toMatchObject({
      userId: '6af06251-1bdf-4808-833a-3e04f4746096',
      creditAmountAllocated: 100,
      created: true,
    });
    expect(result.allocationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('supports an alternative configured allocation', async () => {
    const { manager, builder } = activeManager({ accountCreated: true });

    const result = await createService(250).allocate(
      manager,
      '467a1137-1433-4d42-93ba-09dd9cb670db',
    );

    expect(builder.values).toHaveBeenCalledWith(
      expect.objectContaining({ creditBalance: 250 }),
    );
    expect(result.creditAmountAllocated).toBe(250);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid configured allocation %s before database access',
    (amount) => {
      expect(() => createService(amount)).toThrow(RangeError);
    },
  );

  it('requires an active caller-owned transaction', async () => {
    const manager = {
      queryRunner: { isTransactionActive: false },
      getRepository: vi.fn(),
    } as unknown as EntityManager;

    await expect(
      createService().allocate(manager, 'de3113b3-91f5-4d12-b345-aa4f8c29c343'),
    ).rejects.toBeInstanceOf(AccountAllocationTransactionRequiredError);
    expect(manager.getRepository).not.toHaveBeenCalled();
  });

  it('returns the established allocation without writing', async () => {
    const createdAt = new Date('2026-02-03T04:05:06.000Z');
    const existing = {
      id: '71bdd9f6-8c75-47cc-af84-80a044488f86',
      userId: '20a2c102-f431-414f-bffd-5cb86a2e308a',
      amount: 100,
      createdAt,
    } as CreditAllocation;
    const { manager, repository } = activeManager({ existing });

    await expect(
      createService(250).allocate(manager, existing.userId),
    ).resolves.toEqual({
      userId: existing.userId,
      allocationId: existing.id,
      creditAmountAllocated: 100,
      allocatedAt: createdAt,
      created: false,
    });
    expect(repository.save).not.toHaveBeenCalled();
    expect(manager.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('fails when an existing account has no allocation', async () => {
    const { manager } = activeManager({
      accountCreated: false,
      afterConflict: null,
    });

    await expect(
      createService().allocate(manager, '80188bbf-b083-4d9e-ae11-a01903395320'),
    ).rejects.toBeInstanceOf(AccountAllocationInvariantError);
  });
});
