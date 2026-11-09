import type { DataSource, EntityManager } from 'typeorm';
import { ChatLifecycleEvent } from '../database/entities/index.js';
import { LifecycleFactQueryService } from './lifecycle-fact-query.service.js';

describe('LifecycleFactQueryService', () => {
  it('matches newer participant-specific and errand-wide terminal facts deterministically', async () => {
    const facts = [{} as ChatLifecycleEvent];
    const builder = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      addOrderBy: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue(facts),
    };
    const repository = { createQueryBuilder: vi.fn().mockReturnValue(builder) };
    const getRepository = vi.fn().mockReturnValue(repository);
    const manager = {
      getRepository,
    } as unknown as EntityManager;
    const service = new LifecycleFactQueryService({
      manager,
    } as unknown as DataSource);
    const accepted = {
      errandId: '2062212e-3a39-4a7c-b9bb-d1e743618b61',
      requesterUserId: '21e66a66-257f-4a64-b059-46d353ec21c6',
      courierUserId: 'ea1d20b3-dc12-4498-b750-967c86d74023',
      acceptedAt: new Date('2026-11-04T00:00:00.000Z'),
    };

    await expect(service.findApplicableTerminalFacts(accepted)).resolves.toBe(
      facts,
    );
    expect(getRepository).toHaveBeenCalledWith(ChatLifecycleEvent);
    expect(builder.where).toHaveBeenCalledWith('fact.errand_id = :errandId', {
      errandId: accepted.errandId,
    });
    expect(builder.andWhere).toHaveBeenCalledWith(
      'fact.occurred_at >= :acceptedAt',
      { acceptedAt: accepted.acceptedAt },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining("fact.kind = 'ERRAND_CANCELLED'"),
      {
        requesterUserId: accepted.requesterUserId,
        courierUserId: accepted.courierUserId,
      },
    );
    expect(builder.orderBy).toHaveBeenCalledWith(
      'fact.derived_close_at',
      'ASC',
      'NULLS LAST',
    );
    expect(builder.addOrderBy).toHaveBeenCalledWith('fact.occurred_at', 'ASC');
    expect(builder.addOrderBy).toHaveBeenCalledWith(
      'fact.source_event_id',
      'ASC',
    );
  });

  it('can participate in a caller-owned transaction', async () => {
    const builder = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      addOrderBy: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };
    const transactionGetRepository = vi.fn().mockReturnValue({
      createQueryBuilder: vi.fn().mockReturnValue(builder),
    });
    const transactionManager = {
      getRepository: transactionGetRepository,
    } as unknown as EntityManager;
    const rootGetRepository = vi.fn();
    const rootManager = {
      getRepository: rootGetRepository,
    } as unknown as EntityManager;
    const service = new LifecycleFactQueryService({
      manager: rootManager,
    } as unknown as DataSource);

    await service.findApplicableTerminalFacts(
      {
        errandId: '2062212e-3a39-4a7c-b9bb-d1e743618b61',
        requesterUserId: '21e66a66-257f-4a64-b059-46d353ec21c6',
        courierUserId: 'ea1d20b3-dc12-4498-b750-967c86d74023',
        acceptedAt: new Date('2026-11-04T00:00:00.000Z'),
      },
      transactionManager,
    );

    expect(transactionGetRepository).toHaveBeenCalledOnce();
    expect(rootGetRepository).not.toHaveBeenCalled();
  });
});
