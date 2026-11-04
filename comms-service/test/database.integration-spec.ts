import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { createDatabaseOptions } from '../src/database/database-options.js';
import { Chat } from '../src/database/entities/index.js';

interface Participants {
  requesterUserId: string;
  courierUserId: string;
}

describe('communication persistence migration', () => {
  let dataSource: DataSource;
  let migrationReverted = false;

  beforeAll(async () => {
    if (
      process.env.NODE_ENV !== 'test' ||
      !process.env.DB_DATABASE?.endsWith('_test')
    ) {
      throw new Error(
        'Migration integration tests require a disposable *_test database',
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
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      if (!migrationReverted) {
        await dataSource.undoLastMigration({ transaction: 'all' });
      }
      await dataSource.destroy();
    }
  });

  async function insertInbox(
    eventId: string,
    eventType: string,
  ): Promise<void> {
    await dataSource.query(
      `INSERT INTO inbox_events
       (event_id, event_type, routing_key, publisher, payload_hash)
       VALUES ($1, $2, $3, 'order-service', $4)`,
      [
        eventId,
        eventType,
        `order.${eventType.toLowerCase()}.v1`,
        'a'.repeat(64),
      ],
    );
  }

  async function insertAccepted(
    errandId = randomUUID(),
    participants: Participants = {
      requesterUserId: randomUUID(),
      courierUserId: randomUUID(),
    },
  ): Promise<{ eventId: string; errandId: string } & Participants> {
    const eventId = randomUUID();
    await insertInbox(eventId, 'ErrandAccepted');
    await dataSource.query(
      `INSERT INTO chat_lifecycle_events
       (source_event_id, kind, errand_id, requester_user_id, courier_user_id,
        occurred_at, envelope, payload)
       VALUES ($1, 'ERRAND_ACCEPTED', $2, $3, $4, now(), '{}', '{}')`,
      [
        eventId,
        errandId,
        participants.requesterUserId,
        participants.courierUserId,
      ],
    );
    return { eventId, errandId, ...participants };
  }

  async function insertChat(
    state: 'ACTIVE' | 'GRACE' = 'ACTIVE',
  ): Promise<
    { chatId: string; closesAt: Date | null } & Awaited<
      ReturnType<typeof insertAccepted>
    >
  > {
    const accepted = await insertAccepted();
    const chatId = randomUUID();
    const closesAt = state === 'GRACE' ? new Date(Date.now() - 60_000) : null;
    await dataSource.query(
      `INSERT INTO chats
       (id, acceptance_event_id, errand_id, requester_user_id, courier_user_id,
        accepted_at, state, closes_at, close_reason)
       VALUES ($1, $2, $3, $4, $5, now(), $6, $7, $8)`,
      [
        chatId,
        accepted.eventId,
        accepted.errandId,
        accepted.requesterUserId,
        accepted.courierUserId,
        state,
        closesAt,
        state === 'GRACE' ? 'ERRAND_DELIVERED' : null,
      ],
    );
    return { chatId, closesAt, ...accepted };
  }

  it('creates the tables, constraints, triggers, and query-supporting indexes', async () => {
    const tables = await dataSource.query<{ table_name: string }[]>(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
    `);
    expect(tables.map(({ table_name }) => table_name)).toEqual(
      expect.arrayContaining([
        'inbox_events',
        'chat_lifecycle_events',
        'chats',
        'messages',
        'chat_archives',
      ]),
    );

    const constraints = await dataSource.query<{ conname: string }[]>(`
      SELECT conname FROM pg_constraint
      WHERE connamespace = 'public'::regnamespace
    `);
    expect(constraints.map(({ conname }) => conname)).toEqual(
      expect.arrayContaining([
        'CHK_inbox_events_payload_hash',
        'CHK_chat_lifecycle_events_participants',
        'CHK_chat_lifecycle_events_deadline',
        'CHK_chats_state',
        'CHK_chats_archive_claim',
        'CHK_messages_sequence',
        'CHK_messages_content',
        'CHK_chat_archives_schema_version',
        'FK_chat_lifecycle_events_inbox',
        'FK_chats_acceptance_event',
        'FK_messages_chat',
        'FK_chat_archives_chat',
        'FK_chats_archive',
      ]),
    );

    const indexes = await dataSource.query<
      { indexname: string; indexdef: string }[]
    >(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`);
    const indexNames = indexes.map(({ indexname }) => indexname);
    expect(indexNames).toEqual(
      expect.arrayContaining([
        'IDX_chat_lifecycle_events_errand_kind_occurred_event',
        'IDX_chat_lifecycle_events_participants_errand_occurred',
        'UQ_chats_acceptance_event',
        'UQ_chats_archive',
        'IDX_chats_requester_state_updated_id',
        'IDX_chats_courier_state_updated_id',
        'IDX_chats_errand_state',
        'IDX_chats_due_grace',
        'UQ_messages_chat_sequence',
        'UQ_messages_chat_sender_client',
        'UQ_chat_archives_chat',
        'IDX_chat_archives_requester_archived_id',
        'IDX_chat_archives_courier_archived_id',
      ]),
    );
    expect(
      indexes.find(({ indexname }) => indexname === 'IDX_chats_due_grace')
        ?.indexdef,
    ).toContain(`WHERE ((state = 'GRACE'::text) AND (archive_id IS NULL))`);
    for (const name of [
      'IDX_chat_archives_requester_archived_id',
      'IDX_chat_archives_courier_archived_id',
    ]) {
      expect(
        indexes.find(({ indexname }) => indexname === name)?.indexdef,
      ).toMatch(/archived_at DESC, id DESC/);
    }

    const triggers = await dataSource.query<
      { event_object_table: string; trigger_name: string }[]
    >(`
      SELECT event_object_table, trigger_name FROM information_schema.triggers
      WHERE event_object_table IN ('chat_lifecycle_events', 'chat_archives')
    `);
    expect(triggers).toEqual(
      expect.arrayContaining([
        {
          event_object_table: 'chat_lifecycle_events',
          trigger_name: 'TRG_chat_lifecycle_events_immutable',
        },
        {
          event_object_table: 'chat_archives',
          trigger_name: 'TRG_chat_archives_immutable',
        },
      ]),
    );
  });

  it('deduplicates inbox events and validates canonical hashes', async () => {
    const eventId = randomUUID();
    await insertInbox(eventId, 'ErrandAccepted');
    await expect(insertInbox(eventId, 'ErrandAccepted')).rejects.toMatchObject({
      code: '23505',
    });
    await expect(
      dataSource.query(
        `INSERT INTO inbox_events
         (event_id, event_type, routing_key, publisher, payload_hash)
         VALUES ($1, 'ErrandAccepted', 'order.errand-accepted.v1',
                 'order-service', 'NOT-A-HASH')`,
        [randomUUID()],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'CHK_inbox_events_payload_hash',
    });
  });

  it('enforces participant and event-time lifecycle facts as insert-only', async () => {
    const accepted = await insertAccepted();
    const deliveredEventId = randomUUID();
    await insertInbox(deliveredEventId, 'ErrandDelivered');
    await dataSource.query(
      `INSERT INTO chat_lifecycle_events
       (source_event_id, kind, errand_id, requester_user_id, courier_user_id,
        occurred_at, derived_close_at, envelope, payload)
       VALUES ($1, 'ERRAND_DELIVERED', $2, $3, $4, $5, $5::timestamptz + interval '3 hours', '{}', '{}')`,
      [
        deliveredEventId,
        accepted.errandId,
        accepted.requesterUserId,
        accepted.courierUserId,
        '2026-11-02T00:00:00.000Z',
      ],
    );

    const invalidDeadlineEventId = randomUUID();
    await insertInbox(invalidDeadlineEventId, 'CourierCancelled');
    await expect(
      dataSource.query(
        `INSERT INTO chat_lifecycle_events
         (source_event_id, kind, errand_id, requester_user_id, courier_user_id,
          occurred_at, derived_close_at, envelope, payload)
         VALUES ($1, 'COURIER_CANCELLED', $2, $3, $4, now(), now() + interval '31 minutes', '{}', '{}')`,
        [
          invalidDeadlineEventId,
          accepted.errandId,
          accepted.requesterUserId,
          accepted.courierUserId,
        ],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'CHK_chat_lifecycle_events_deadline',
    });

    await expect(
      dataSource.query(
        `UPDATE chat_lifecycle_events SET payload = '{"changed":true}'
         WHERE source_event_id = $1`,
        [accepted.eventId],
      ),
    ).rejects.toThrow('chat_lifecycle_events is insert-only');
    await expect(
      dataSource.query(
        'DELETE FROM chat_lifecycle_events WHERE source_event_id = $1',
        [accepted.eventId],
      ),
    ).rejects.toThrow('chat_lifecycle_events is insert-only');
  });

  it('enforces chat state, identity, sequence, and expiring claim invariants', async () => {
    const active = await insertChat();
    await expect(
      dataSource.query(
        `UPDATE chats SET state = 'GRACE', close_reason = 'ERRAND_DELIVERED'
         WHERE id = $1`,
        [active.chatId],
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'CHK_chats_state' });
    await expect(
      dataSource.query('UPDATE chats SET next_sequence = 0 WHERE id = $1', [
        active.chatId,
      ]),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'CHK_chats_next_sequence',
    });

    const grace = await insertChat('GRACE');
    await expect(
      dataSource.query(
        'UPDATE chats SET archive_claim_token = $2 WHERE id = $1',
        [grace.chatId, randomUUID()],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'CHK_chats_archive_claim',
    });

    const claimToken = randomUUID();
    await dataSource.query(
      `UPDATE chats
       SET created_at = now() - interval '2 hours',
           archive_claim_token = $2,
           archive_claim_expires_at = now() - interval '1 hour'
       WHERE id = $1`,
      [grace.chatId, claimToken],
    );
    const expiredClaims = await dataSource.query<{ id: string }[]>(
      `SELECT id FROM chats
       WHERE archive_claim_token IS NOT NULL AND archive_claim_expires_at <= now()`,
    );
    expect(expiredClaims).toContainEqual({ id: grace.chatId });

    const repository = dataSource.getRepository(Chat);
    await expect(
      repository.findOneByOrFail({ id: grace.chatId }),
    ).resolves.toMatchObject({
      archiveClaimToken: claimToken,
      state: 'GRACE',
    });
  });

  it('enforces ordered and idempotent messages with bounded nonblank content', async () => {
    const chat = await insertChat();
    const clientMessageId = randomUUID();
    await dataSource.query(
      `INSERT INTO messages
       (id, chat_id, sequence, sender_id, client_message_id, content)
       VALUES ($1, $2, 1, $3, $4, 'hello')`,
      [randomUUID(), chat.chatId, chat.requesterUserId, clientMessageId],
    );
    await expect(
      dataSource.query(
        `INSERT INTO messages
         (id, chat_id, sequence, sender_id, client_message_id, content)
         VALUES ($1, $2, 1, $3, $4, 'another')`,
        [randomUUID(), chat.chatId, chat.courierUserId, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      dataSource.query(
        `INSERT INTO messages
         (id, chat_id, sequence, sender_id, client_message_id, content)
         VALUES ($1, $2, 2, $3, $4, 'retry')`,
        [randomUUID(), chat.chatId, chat.requesterUserId, clientMessageId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    for (const content of ['   ', 'x'.repeat(4_001)]) {
      await expect(
        dataSource.query(
          `INSERT INTO messages
           (id, chat_id, sequence, sender_id, client_message_id, content)
           VALUES ($1, $2, 2, $3, $4, $5)`,
          [
            randomUUID(),
            chat.chatId,
            chat.requesterUserId,
            randomUUID(),
            content,
          ],
        ),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'CHK_messages_content',
      });
    }
  });

  it('links one immutable versioned archive back to its archived chat', async () => {
    const chat = await insertChat('GRACE');
    const archiveId = randomUUID();
    const snapshot = {
      schemaVersion: 1,
      chatId: chat.chatId,
      errandId: chat.errandId,
      requesterUserId: chat.requesterUserId,
      courierUserId: chat.courierUserId,
      archivedAt: new Date().toISOString(),
      messages: [],
    };
    await dataSource.query(
      `INSERT INTO chat_archives
       (id, chat_id, errand_id, requester_user_id, courier_user_id, snapshot)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        archiveId,
        chat.chatId,
        chat.errandId,
        chat.requesterUserId,
        chat.courierUserId,
        snapshot,
      ],
    );
    await dataSource.query(
      `UPDATE chats
       SET state = 'ARCHIVED', archive_id = $2,
           archive_claim_token = NULL, archive_claim_expires_at = NULL
       WHERE id = $1`,
      [chat.chatId, archiveId],
    );

    const [linked] = await dataSource.query<
      { state: string; archive_id: string; chat_id: string }[]
    >(
      `
      SELECT c.state, c.archive_id, a.chat_id
      FROM chats c JOIN chat_archives a ON a.id = c.archive_id
      WHERE c.id = $1
    `,
      [chat.chatId],
    );
    expect(linked).toEqual({
      state: 'ARCHIVED',
      archive_id: archiveId,
      chat_id: chat.chatId,
    });

    await expect(
      dataSource.query(
        `UPDATE chat_archives SET snapshot = '{"schemaVersion":1}' WHERE id = $1`,
        [archiveId],
      ),
    ).rejects.toThrow('chat_archives is immutable');
    await expect(
      dataSource.query('DELETE FROM chat_archives WHERE id = $1', [archiveId]),
    ).rejects.toThrow('chat_archives is immutable');

    const otherArchive = randomUUID();
    await expect(
      dataSource.query(
        `INSERT INTO chat_archives
         (id, chat_id, errand_id, requester_user_id, courier_user_id, snapshot)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          otherArchive,
          chat.chatId,
          chat.errandId,
          chat.requesterUserId,
          chat.courierUserId,
          snapshot,
        ],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('rejects unsupported archive versions and missing archive references', async () => {
    const chat = await insertChat('GRACE');
    await expect(
      dataSource.query(
        `INSERT INTO chat_archives
         (id, chat_id, errand_id, requester_user_id, courier_user_id,
          schema_version, snapshot)
         VALUES ($1, $2, $3, $4, $5, 2, '{"schemaVersion":2}')`,
        [
          randomUUID(),
          chat.chatId,
          chat.errandId,
          chat.requesterUserId,
          chat.courierUserId,
        ],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'CHK_chat_archives_schema_version',
    });
    await expect(
      dataSource.query(
        `UPDATE chats SET state = 'ARCHIVED', archive_id = $2 WHERE id = $1`,
        [chat.chatId, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23503', constraint: 'FK_chats_archive' });
  });

  it('reverts and reapplies the entire schema cleanly', async () => {
    await dataSource.undoLastMigration({ transaction: 'all' });
    const missing = await dataSource.query<{ table_name: string }[]>(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'inbox_events', 'chat_lifecycle_events', 'chats', 'messages', 'chat_archives'
        )
    `);
    expect(missing).toEqual([]);

    await dataSource.runMigrations({ transaction: 'all' });
    const reapplied = await dataSource.query<{ table_name: string }[]>(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'chats'
    `);
    expect(reapplied).toEqual([{ table_name: 'chats' }]);

    await dataSource.undoLastMigration({ transaction: 'all' });
    migrationReverted = true;
  });
});
