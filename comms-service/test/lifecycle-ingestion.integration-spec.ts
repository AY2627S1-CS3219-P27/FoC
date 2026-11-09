import { randomUUID } from 'node:crypto';
import type {
  ErrandAcceptedEvent,
  ErrandCancelledEvent,
  ErrandDeliveredEvent,
} from '@foc/contracts';
import { DataSource } from 'typeorm';
import { createDatabaseOptions } from '../src/database/database-options.js';
import { LifecycleFactQueryService } from '../src/lifecycle/lifecycle-fact-query.service.js';
import { LifecycleIngestionService } from '../src/lifecycle/lifecycle-ingestion.service.js';

describe('inbox-backed lifecycle ingestion', () => {
  let dataSource: DataSource;
  let ingestion: LifecycleIngestionService;
  let facts: LifecycleFactQueryService;
  const errandId = randomUUID();
  const requesterUserId = randomUUID();
  const courierUserId = randomUUID();

  function accepted(
    eventId = randomUUID(),
    timestamp = '2026-11-04T00:00:00.000Z',
  ): ErrandAcceptedEvent {
    return {
      eventId,
      eventType: 'ErrandAccepted',
      timestamp,
      publisher: 'order-service',
      payload: { errandId, requesterUserId, courierUserId },
    };
  }

  function delivered(
    eventId = randomUUID(),
    timestamp = '2026-11-04T01:00:00.000Z',
  ): ErrandDeliveredEvent {
    return {
      eventId,
      eventType: 'ErrandDelivered',
      timestamp,
      publisher: 'order-service',
      payload: { errandId, requesterUserId, courierUserId },
    };
  }

  beforeAll(async () => {
    if (
      process.env.NODE_ENV !== 'test' ||
      !process.env.DB_DATABASE?.endsWith('_test')
    ) {
      throw new Error(
        'Lifecycle integration tests require a disposable *_test database',
      );
    }
    dataSource = new DataSource(
      createDatabaseOptions({
        DB_HOST: process.env.DB_HOST!,
        DB_PORT: Number(process.env.DB_PORT),
        DB_USERNAME: process.env.DB_USERNAME!,
        DB_DATABASE: process.env.DB_DATABASE,
        DB_PASSWORD_FILE: process.env.DB_PASSWORD_FILE!,
      }),
    );
    await dataSource.initialize();
    await dataSource.dropDatabase();
    await dataSource.runMigrations({ transaction: 'all' });
    facts = new LifecycleFactQueryService(dataSource);
    ingestion = new LifecycleIngestionService(dataSource, facts);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.undoLastMigration({ transaction: 'all' });
      await dataSource.undoLastMigration({ transaction: 'all' });
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE TABLE chat_archives, messages, chats, chat_lifecycle_events, inbox_events',
    );
  });

  it('converges concurrent delivery on one inbox fact and one chat', async () => {
    const event = accepted();
    const outcomes = await Promise.all([
      ingestion.process(event, 'order.errand-accepted.v1'),
      ingestion.process(structuredClone(event), 'order.errand-accepted.v1'),
    ]);

    expect(outcomes.map(({ status }) => status).sort()).toEqual([
      'duplicate',
      'recorded',
    ]);
    const [counts] = await dataSource.query<
      Array<{ inbox: string; facts: string; chats: string }>
    >(`
      SELECT
        (SELECT count(*) FROM inbox_events)::text AS inbox,
        (SELECT count(*) FROM chat_lifecycle_events)::text AS facts,
        (SELECT count(*) FROM chats)::text AS chats
    `);
    expect(counts).toEqual({ inbox: '1', facts: '1', chats: '1' });
  });

  it('preserves established evidence when an event ID is reused', async () => {
    const event = accepted();
    await ingestion.process(event, 'order.errand-accepted.v1');

    await expect(
      ingestion.process(
        { ...event, timestamp: '2026-11-04T00:00:01.000Z' },
        'order.errand-accepted.v1',
      ),
    ).resolves.toEqual({
      status: 'event-id-conflict',
      eventId: event.eventId,
    });
    const [stored] = await dataSource.query<Array<{ timestamp: string }>>(
      `SELECT envelope->>'timestamp' AS timestamp
       FROM chat_lifecycle_events WHERE source_event_id = $1`,
      [event.eventId],
    );
    expect(stored.timestamp).toBe(event.timestamp);
  });

  it('creates distinct chats when the same errand is accepted again', async () => {
    await ingestion.process(accepted(), 'order.errand-accepted.v1');
    await ingestion.process(
      accepted(randomUUID(), '2026-11-04T02:00:00.000Z'),
      'order.errand-accepted.v1',
    );
    const [count] = await dataSource.query<Array<{ count: string }>>(
      'SELECT count(*)::text AS count FROM chats WHERE errand_id = $1',
      [errandId],
    );
    expect(count.count).toBe('2');
  });

  it('retains terminal-before-acceptance facts for deterministic matching', async () => {
    const terminal = delivered();
    await ingestion.process(terminal, 'order.errand-delivered.v1');
    const acceptance = accepted();
    await ingestion.process(acceptance, 'order.errand-accepted.v1');

    const applicable = await facts.findApplicableTerminalFacts({
      errandId,
      requesterUserId,
      courierUserId,
      acceptedAt: new Date(acceptance.timestamp),
    });
    expect(applicable.map(({ sourceEventId }) => sourceEventId)).toEqual([
      terminal.eventId,
    ]);
    const [chat] = await dataSource.query<
      Array<{
        state: string;
        closes_at: Date;
        close_reason: string;
      }>
    >('SELECT state, closes_at, close_reason FROM chats');
    expect(chat).toMatchObject({
      state: 'GRACE',
      closes_at: new Date('2026-11-04T04:00:00.000Z'),
      close_reason: 'ERRAND_DELIVERED',
    });
  });

  it('serializes concurrent acceptance and terminal facts for the same errand', async () => {
    const acceptance = accepted();
    const terminal = delivered();

    await Promise.all([
      ingestion.process(acceptance, 'order.errand-accepted.v1'),
      ingestion.process(terminal, 'order.errand-delivered.v1'),
    ]);

    const [chat] = await dataSource.query<
      Array<{ state: string; closes_at: Date; close_reason: string }>
    >('SELECT state, closes_at, close_reason FROM chats');
    expect(chat).toEqual({
      state: 'GRACE',
      closes_at: new Date('2026-11-04T04:00:00.000Z'),
      close_reason: 'ERRAND_DELIVERED',
    });
  });

  it('applies a terminal deadline to an existing exact-participant chat', async () => {
    await ingestion.process(accepted(), 'order.errand-accepted.v1');

    const outcome = await ingestion.process(
      delivered(),
      'order.errand-delivered.v1',
    );

    expect(outcome).toMatchObject({
      status: 'recorded',
      deadlineTransitions: [
        {
          requesterUserId,
          courierUserId,
          closesAt: new Date('2026-11-04T04:00:00.000Z'),
          closeReason: 'ERRAND_DELIVERED',
        },
      ],
    });
    const [chat] = await dataSource.query<
      Array<{ state: string; closes_at: Date; close_reason: string }>
    >('SELECT state, closes_at, close_reason FROM chats');
    expect(chat).toEqual({
      state: 'GRACE',
      closes_at: new Date('2026-11-04T04:00:00.000Z'),
      close_reason: 'ERRAND_DELIVERED',
    });
  });

  it('shortens an existing deadline but never extends or reorders it', async () => {
    await ingestion.process(accepted(), 'order.errand-accepted.v1');
    await ingestion.process(
      delivered(randomUUID(), '2026-11-04T01:00:00.000Z'),
      'order.errand-delivered.v1',
    );
    const cancellation: ErrandCancelledEvent = {
      eventId: randomUUID(),
      eventType: 'ErrandCancelled',
      timestamp: '2026-11-04T02:00:00.000Z',
      publisher: 'order-service',
      payload: { errandId },
    };
    const shortened = await ingestion.process(
      cancellation,
      'order.errand-cancelled.v1',
    );
    expect(shortened).toMatchObject({
      deadlineTransitions: [
        {
          closesAt: new Date('2026-11-04T02:30:00.000Z'),
          closeReason: 'ERRAND_CANCELLED',
        },
      ],
    });

    const later = await ingestion.process(
      delivered(randomUUID(), '2026-11-04T03:00:00.000Z'),
      'order.errand-delivered.v1',
    );
    expect(later).toMatchObject({ deadlineTransitions: [] });
    const [chat] = await dataSource.query<
      Array<{ closes_at: Date; close_reason: string }>
    >('SELECT closes_at, close_reason FROM chats');
    expect(chat).toEqual({
      closes_at: new Date('2026-11-04T02:30:00.000Z'),
      close_reason: 'ERRAND_CANCELLED',
    });
  });

  it('converges concurrent terminal facts on the earliest deadline', async () => {
    await ingestion.process(accepted(), 'order.errand-accepted.v1');
    const cancellation: ErrandCancelledEvent = {
      eventId: randomUUID(),
      eventType: 'ErrandCancelled',
      timestamp: '2026-11-04T02:00:00.000Z',
      publisher: 'order-service',
      payload: { errandId },
    };

    await Promise.all([
      ingestion.process(
        delivered(randomUUID(), '2026-11-04T01:00:00.000Z'),
        'order.errand-delivered.v1',
      ),
      ingestion.process(cancellation, 'order.errand-cancelled.v1'),
    ]);

    const [chat] = await dataSource.query<
      Array<{ closes_at: Date; close_reason: string }>
    >('SELECT closes_at, close_reason FROM chats');
    expect(chat).toEqual({
      closes_at: new Date('2026-11-04T02:30:00.000Z'),
      close_reason: 'ERRAND_CANCELLED',
    });
  });

  it('does not apply exact-participant terminal facts to a reaccepted courier', async () => {
    const otherCourierUserId = randomUUID();
    await ingestion.process(accepted(), 'order.errand-accepted.v1');
    const reaccepted = accepted(randomUUID(), '2026-11-04T00:30:00.000Z');
    reaccepted.payload.courierUserId = otherCourierUserId;
    await ingestion.process(reaccepted, 'order.errand-accepted.v1');

    await ingestion.process(delivered(), 'order.errand-delivered.v1');

    const rows = await dataSource.query<
      Array<{ courier_user_id: string; state: string }>
    >('SELECT courier_user_id, state FROM chats ORDER BY accepted_at');
    expect(rows).toEqual([
      { courier_user_id: courierUserId, state: 'GRACE' },
      { courier_user_id: otherCourierUserId, state: 'ACTIVE' },
    ]);
  });

  it('applies errand cancellation to every eligible non-archived chat', async () => {
    const otherCourierUserId = randomUUID();
    await ingestion.process(accepted(), 'order.errand-accepted.v1');
    const reaccepted = accepted(randomUUID(), '2026-11-04T00:05:00.000Z');
    reaccepted.payload.courierUserId = otherCourierUserId;
    await ingestion.process(reaccepted, 'order.errand-accepted.v1');
    const cancellation: ErrandCancelledEvent = {
      eventId: randomUUID(),
      eventType: 'ErrandCancelled',
      timestamp: '2026-11-04T00:10:00.000Z',
      publisher: 'order-service',
      payload: { errandId },
    };

    const outcome = await ingestion.process(
      cancellation,
      'order.errand-cancelled.v1',
    );

    expect(outcome).toMatchObject({
      status: 'recorded',
      deadlineTransitions: [
        { closeReason: 'ERRAND_CANCELLED' },
        { closeReason: 'ERRAND_CANCELLED' },
      ],
    });
    const rows = await dataSource.query<
      Array<{ state: string; closes_at: Date }>
    >('SELECT state, closes_at FROM chats ORDER BY id');
    expect(rows).toEqual([
      {
        state: 'GRACE',
        closes_at: new Date('2026-11-04T00:40:00.000Z'),
      },
      {
        state: 'GRACE',
        closes_at: new Date('2026-11-04T00:40:00.000Z'),
      },
    ]);
  });

  it('matches errand cancellation broadly but excludes older terminal facts', async () => {
    await ingestion.process(
      delivered(randomUUID(), '2026-11-03T23:59:59.000Z'),
      'order.errand-delivered.v1',
    );
    const cancellation: ErrandCancelledEvent = {
      eventId: randomUUID(),
      eventType: 'ErrandCancelled',
      timestamp: '2026-11-04T00:10:00.000Z',
      publisher: 'order-service',
      payload: { errandId },
    };
    await ingestion.process(cancellation, 'order.errand-cancelled.v1');

    const applicable = await facts.findApplicableTerminalFacts({
      errandId,
      requesterUserId,
      courierUserId,
      acceptedAt: new Date('2026-11-04T00:00:00.000Z'),
    });
    expect(applicable.map(({ sourceEventId }) => sourceEventId)).toEqual([
      cancellation.eventId,
    ]);
  });

  it('rolls back inbox and fact writes when chat creation violates an invariant', async () => {
    const event = accepted();
    event.payload.courierUserId = event.payload.requesterUserId;

    await expect(
      ingestion.process(event, 'order.errand-accepted.v1'),
    ).rejects.toMatchObject({
      constraint: 'CHK_chat_lifecycle_events_participants',
    });
    const [count] = await dataSource.query<Array<{ count: string }>>(
      'SELECT count(*)::text AS count FROM inbox_events WHERE event_id = $1',
      [event.eventId],
    );
    expect(count.count).toBe('0');
  });
});
