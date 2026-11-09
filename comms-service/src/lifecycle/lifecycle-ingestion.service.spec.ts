import type { ErrandAcceptedEvent, ErrandDeliveredEvent } from '@foc/contracts';
import type { DataSource, EntityManager } from 'typeorm';
import {
  Chat,
  ChatLifecycleEvent,
  InboxEvent,
} from '../database/entities/index.js';
import { hashCanonicalJson } from './canonical-json.js';
import { LifecycleFactQueryService } from './lifecycle-fact-query.service.js';
import { LifecycleIngestionService } from './lifecycle-ingestion.service.js';

const ids = {
  eventId: '98f5905c-2cd6-4e4c-b3d2-eaa87440af87',
  secondEventId: '07a82e6d-35b6-4213-a8bd-43a935272ded',
  errandId: '2062212e-3a39-4a7c-b9bb-d1e743618b61',
  requesterUserId: '21e66a66-257f-4a64-b059-46d353ec21c6',
  courierUserId: 'ea1d20b3-dc12-4498-b750-967c86d74023',
};

function accepted(eventId = ids.eventId): ErrandAcceptedEvent {
  return {
    eventId,
    eventType: 'ErrandAccepted',
    timestamp: '2026-11-04T00:00:00.000Z',
    publisher: 'order-service',
    payload: {
      errandId: ids.errandId,
      requesterUserId: ids.requesterUserId,
      courierUserId: ids.courierUserId,
    },
  };
}

function delivered(eventId = ids.eventId): ErrandDeliveredEvent {
  return {
    ...accepted(eventId),
    eventType: 'ErrandDelivered',
  };
}

interface FakeRepository<T extends object> {
  rows: T[];
  create: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  findOneBy: ReturnType<typeof vi.fn>;
}

function repository<T extends object>(): FakeRepository<T> {
  const rows: T[] = [];
  return {
    rows,
    create: vi.fn((value: T) => value),
    save: vi.fn(async (value: T) => {
      rows.push(value);
      return value;
    }),
    findOneBy: vi.fn(async () => null),
  };
}

function harness() {
  const inbox = repository<InboxEvent>();
  inbox.findOneBy.mockImplementation(async ({ eventId }: { eventId: string }) =>
    inbox.rows.find((row) => row.eventId === eventId),
  );
  const lifecycle = repository<ChatLifecycleEvent>();
  const chats = repository<Chat>();
  const query = vi.fn().mockResolvedValue([]);
  const findApplicableTerminalFacts = vi.fn().mockResolvedValue([]);
  const facts = {
    findApplicableTerminalFacts,
  } as unknown as LifecycleFactQueryService;
  const manager = {
    query,
    getRepository: vi.fn((entity: unknown) => {
      if (entity === InboxEvent) return inbox;
      if (entity === ChatLifecycleEvent) return lifecycle;
      if (entity === Chat) return chats;
      throw new Error('unknown repository');
    }),
  } as unknown as EntityManager;
  const transaction = vi.fn(
    async (work: (entityManager: EntityManager) => Promise<unknown>) =>
      work(manager),
  );
  const dataSource = { transaction } as unknown as DataSource;
  const service = new LifecycleIngestionService(dataSource, facts);
  return {
    chats,
    findApplicableTerminalFacts,
    inbox,
    lifecycle,
    manager,
    query,
    service,
    transaction,
  };
}

describe('LifecycleIngestionService', () => {
  it('atomically records an acceptance and creates one active chat', async () => {
    const { chats, inbox, lifecycle, query, service, transaction } = harness();
    const event = accepted();

    const result = await service.process(event, 'order.errand-accepted.v1');

    expect(result).toMatchObject({
      status: 'recorded',
      eventId: event.eventId,
      chatId: expect.any(String),
    });
    expect(transaction).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [event.eventId],
    );
    expect(query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 1))',
      [ids.errandId],
    );
    expect(inbox.rows).toEqual([
      expect.objectContaining({
        eventId: event.eventId,
        eventType: event.eventType,
        routingKey: 'order.errand-accepted.v1',
        publisher: 'order-service',
        payloadHash: hashCanonicalJson(event),
      }),
    ]);
    expect(lifecycle.rows).toEqual([
      expect.objectContaining({
        sourceEventId: event.eventId,
        kind: 'ERRAND_ACCEPTED',
        errandId: ids.errandId,
        derivedCloseAt: null,
      }),
    ]);
    expect(chats.rows).toEqual([
      expect.objectContaining({
        acceptanceEventId: event.eventId,
        errandId: ids.errandId,
        requesterUserId: ids.requesterUserId,
        courierUserId: ids.courierUserId,
        state: 'ACTIVE',
        nextSequence: '1',
      }),
    ]);
  });

  it('returns duplicate for the same canonical evidence without another fact or chat', async () => {
    const { chats, lifecycle, service } = harness();
    const event = accepted();
    await service.process(event, 'order.errand-accepted.v1');

    await expect(
      service.process(structuredClone(event), 'order.errand-accepted.v1'),
    ).resolves.toEqual({ status: 'duplicate', eventId: event.eventId });
    expect(lifecycle.rows).toHaveLength(1);
    expect(chats.rows).toHaveLength(1);
  });

  it.each([
    ['different route', accepted(), 'order.errand-delivered.v1'],
    [
      'different timestamp',
      { ...accepted(), timestamp: '2026-11-04T00:00:01.000Z' },
      'order.errand-accepted.v1',
    ],
  ])('returns identity conflict for %s', async (_name, conflicting, route) => {
    const { chats, inbox, lifecycle, service } = harness();
    const original = accepted();
    await service.process(original, 'order.errand-accepted.v1');

    await expect(service.process(conflicting, route)).resolves.toEqual({
      status: 'event-id-conflict',
      eventId: original.eventId,
    });
    expect(inbox.rows).toHaveLength(1);
    expect(lifecycle.rows).toHaveLength(1);
    expect(chats.rows).toHaveLength(1);
  });

  it('retains terminal-before-acceptance evidence without creating a chat', async () => {
    const { chats, lifecycle, service } = harness();
    const event = delivered();

    await expect(
      service.process(event, 'order.errand-delivered.v1'),
    ).resolves.toEqual({
      status: 'recorded',
      eventId: event.eventId,
      deadlineTransitions: [],
    });
    expect(chats.rows).toHaveLength(0);
    expect(lifecycle.rows).toEqual([
      expect.objectContaining({
        kind: 'ERRAND_DELIVERED',
        derivedCloseAt: new Date('2026-11-04T03:00:00.000Z'),
      }),
    ]);
  });

  it('creates an acceptance directly in grace from the earliest retained terminal fact', async () => {
    const { chats, findApplicableTerminalFacts, service } = harness();
    findApplicableTerminalFacts.mockResolvedValue([
      {
        kind: 'COURIER_CANCELLED',
        derivedCloseAt: new Date('2026-11-04T00:30:00.000Z'),
      } as ChatLifecycleEvent,
    ]);

    const result = await service.process(
      accepted(),
      'order.errand-accepted.v1',
    );

    expect(result).toMatchObject({
      status: 'recorded',
      deadlineTransitions: [],
    });
    expect(chats.rows).toEqual([
      expect.objectContaining({
        state: 'GRACE',
        closesAt: new Date('2026-11-04T00:30:00.000Z'),
        closeReason: 'COURIER_CANCELLED',
      }),
    ]);
  });

  it('returns committed terminal deadline transitions', async () => {
    const { query, service } = harness();
    query.mockImplementation(async (sql: string) =>
      sql.includes('WITH matching AS')
        ? [
            {
              chat_id: '702b39c7-063d-4137-928a-3a473a14f757',
              requester_user_id: ids.requesterUserId,
              courier_user_id: ids.courierUserId,
              closes_at: new Date('2026-11-04T03:00:00.000Z'),
              close_reason: 'ERRAND_DELIVERED',
            },
          ]
        : [],
    );

    await expect(
      service.process(delivered(), 'order.errand-delivered.v1'),
    ).resolves.toEqual({
      status: 'recorded',
      eventId: ids.eventId,
      deadlineTransitions: [
        {
          chatId: '702b39c7-063d-4137-928a-3a473a14f757',
          requesterUserId: ids.requesterUserId,
          courierUserId: ids.courierUserId,
          closesAt: new Date('2026-11-04T03:00:00.000Z'),
          closeReason: 'ERRAND_DELIVERED',
        },
      ],
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE'), [
      ids.errandId,
      new Date('2026-11-04T00:00:00.000Z'),
      'ERRAND_DELIVERED',
      ids.requesterUserId,
      ids.courierUserId,
      new Date('2026-11-04T03:00:00.000Z'),
    ]);
  });

  it('creates distinct chats for distinct acceptance IDs on the same errand', async () => {
    const { chats, service } = harness();
    const first = await service.process(
      accepted(ids.eventId),
      'order.errand-accepted.v1',
    );
    const second = await service.process(
      accepted(ids.secondEventId),
      'order.errand-accepted.v1',
    );

    expect(first).toMatchObject({ status: 'recorded' });
    expect(second).toMatchObject({ status: 'recorded' });
    expect(chats.rows).toHaveLength(2);
    expect(new Set(chats.rows.map((chat) => chat.id)).size).toBe(2);
  });
});
