import { randomUUID } from 'node:crypto';
import type { ErrandAcceptedEvent } from '@foc/contracts';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ChatCursorCodec } from '../src/chats/chat-cursor.codec.js';
import { ChatQueryService } from '../src/chats/chat-query.service.js';
import { createDatabaseOptions } from '../src/database/database-options.js';
import { LifecycleFactQueryService } from '../src/lifecycle/lifecycle-fact-query.service.js';
import { LifecycleIngestionService } from '../src/lifecycle/lifecycle-ingestion.service.js';

describe('participant-only chat queries', () => {
  let dataSource: DataSource;
  let ingestion: LifecycleIngestionService;
  let queries: ChatQueryService;

  const requesterId = randomUUID();
  const courierId = randomUUID();
  const outsiderId = randomUUID();

  async function createChat(
    timestamp: string,
    participants = { requesterId, courierId },
  ): Promise<string> {
    const event: ErrandAcceptedEvent = {
      eventId: randomUUID(),
      eventType: 'ErrandAccepted',
      timestamp,
      publisher: 'order-service',
      payload: {
        errandId: randomUUID(),
        requesterUserId: participants.requesterId,
        courierUserId: participants.courierId,
      },
    };
    const result = await ingestion.process(event, 'order.errand-accepted.v1');
    if (result.status !== 'recorded' || result.chatId === undefined) {
      throw new Error('Expected accepted event to create a chat');
    }
    await dataSource.query('UPDATE chats SET updated_at = $2 WHERE id = $1', [
      result.chatId,
      timestamp,
    ]);
    return result.chatId;
  }

  async function createMessage(input: {
    chatId: string;
    sequence: number;
    senderId: string;
    content: string;
    committedAt: string;
    readAt?: string;
  }): Promise<void> {
    await dataSource.query(
      `INSERT INTO messages
       (id, chat_id, sequence, sender_id, client_message_id, content,
        committed_at, read_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        randomUUID(),
        input.chatId,
        input.sequence,
        input.senderId,
        randomUUID(),
        input.content,
        input.committedAt,
        input.readAt ?? null,
      ],
    );
  }

  async function archiveChat(
    chatId: string,
    archivedAt = '2026-11-06T02:00:00.000Z',
    messages: Array<{
      role: 'REQUESTER' | 'COURIER';
      content: string;
      timestamp: string;
    }> = [],
  ): Promise<string> {
    const archiveId = randomUUID();
    const [chat] = await dataSource.query<
      Array<{
        errand_id: string;
        requester_user_id: string;
        courier_user_id: string;
      }>
    >(
      `SELECT errand_id, requester_user_id, courier_user_id
         FROM chats WHERE id = $1`,
      [chatId],
    );
    if (!chat) throw new Error('Expected chat to archive');
    await dataSource.query(
      `UPDATE chats
          SET state = 'GRACE', closes_at = now(), close_reason = 'ERRAND_DELIVERED'
        WHERE id = $1`,
      [chatId],
    );
    await dataSource.query(
      `INSERT INTO chat_archives
       (id, chat_id, errand_id, requester_user_id, courier_user_id,
        archived_at, schema_version, snapshot)
       SELECT $2, id, errand_id, requester_user_id, courier_user_id,
              $3::timestamptz, 1, $4::jsonb
         FROM chats WHERE id = $1`,
      [
        chatId,
        archiveId,
        archivedAt,
        JSON.stringify({
          schemaVersion: 1,
          chatId,
          errandId: chat.errand_id,
          requesterUserId: chat.requester_user_id,
          courierUserId: chat.courier_user_id,
          archivedAt: new Date(archivedAt).toISOString(),
          messages,
        }),
      ],
    );
    await dataSource.query(
      `UPDATE chats SET state = 'ARCHIVED', archive_id = $2 WHERE id = $1`,
      [chatId, archiveId],
    );
    return archiveId;
  }

  beforeAll(async () => {
    if (
      process.env.NODE_ENV !== 'test' ||
      !process.env.DB_DATABASE?.endsWith('_test')
    ) {
      throw new Error(
        'Chat integration tests require a disposable *_test database',
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
    ingestion = new LifecycleIngestionService(
      dataSource,
      new LifecycleFactQueryService(dataSource),
    );
    queries = new ChatQueryService(dataSource, new ChatCursorCodec());
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

  it('lists requester and courier chats with stable keyset pages and relative unread state', async () => {
    const older = await createChat('2026-11-04T01:00:00.000Z');
    const newer = await createChat('2026-11-04T02:00:00.000Z');
    const archived = await createChat('2026-11-04T04:00:00.000Z');
    await archiveChat(archived);
    await createChat('2026-11-04T03:00:00.000Z', {
      requesterId: outsiderId,
      courierId: randomUUID(),
    });
    await createMessage({
      chatId: newer,
      sequence: 1,
      senderId: requesterId,
      content: 'From requester',
      committedAt: '2026-11-04T02:01:00.000Z',
    });
    await createMessage({
      chatId: newer,
      sequence: 2,
      senderId: courierId,
      content: 'From courier',
      committedAt: '2026-11-04T02:02:00.000Z',
    });

    const requesterPage = await queries.list(requesterId, undefined, 1);
    expect(requesterPage).toMatchObject({
      items: [
        {
          chatId: newer,
          lastMessage: { sequence: 2, content: 'From courier' },
          unread: true,
        },
      ],
      hasMore: true,
    });
    const finalPage = await queries.list(
      requesterId,
      requesterPage.nextCursor!,
      1,
    );
    expect(finalPage).toMatchObject({
      items: [{ chatId: older, lastMessage: null, unread: false }],
      hasMore: false,
      nextCursor: null,
    });

    const courierPage = await queries.list(courierId, undefined, 20);
    expect(courierPage.items[0]).toMatchObject({ chatId: newer, unread: true });
    expect(courierPage.items).toHaveLength(2);
  });

  it('does not skip chats whose ordering timestamps differ only by microseconds', async () => {
    await createChat('2026-11-04T02:00:00.000600Z');
    await createChat('2026-11-04T02:00:00.000400Z');
    await createChat('2026-11-04T02:00:00.000400Z');
    await createChat('2026-11-04T02:00:00.000200Z');
    const expected = await dataSource.query<Array<{ id: string }>>(
      `SELECT id
         FROM chats
        WHERE requester_user_id = $1
        ORDER BY updated_at DESC, id DESC`,
      [requesterId],
    );

    const actual: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await queries.list(requesterId, cursor, 1);
      actual.push(...page.items.map(({ chatId }) => chatId));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    expect(actual).toEqual(expected.map(({ id }) => id));
    expect(new Set(actual).size).toBe(expected.length);
  });

  it('returns ascending history pages and conceals absent and unauthorized chats', async () => {
    const chatId = await createChat('2026-11-04T01:00:00.000Z');
    await createMessage({
      chatId,
      sequence: 1,
      senderId: requesterId,
      content: 'Read',
      committedAt: '2026-11-04T01:01:00.000Z',
      readAt: '2026-11-04T01:02:00.000Z',
    });
    await createMessage({
      chatId,
      sequence: 2,
      senderId: courierId,
      content: 'Unread',
      committedAt: '2026-11-04T01:03:00.000Z',
    });

    const first = await queries.history(requesterId, chatId, undefined, 1);
    expect(first).toMatchObject({
      items: [{ sequence: 1, status: 'READ' }],
      hasMore: true,
    });
    await expect(
      queries.history(requesterId, chatId, first.nextCursor!, 1),
    ).resolves.toMatchObject({
      items: [{ sequence: 2, status: 'UNREAD' }],
      hasMore: false,
      nextCursor: null,
    });

    const expected = new NotFoundException({
      code: 'CHAT_NOT_FOUND',
      message: 'Chat not found',
    });
    await expect(
      queries.history(outsiderId, chatId, undefined, 20),
    ).rejects.toEqual(expected);
    await expect(
      queries.history(requesterId, randomUUID(), undefined, 20),
    ).rejects.toEqual(expected);
    await archiveChat(chatId);
    await expect(
      queries.history(requesterId, chatId, undefined, 20),
    ).rejects.toEqual(expected);
  });

  it('lists only participant archives newest-first without microsecond pagination gaps', async () => {
    const firstChat = await createChat('2026-11-04T01:00:00.000Z');
    const secondChat = await createChat('2026-11-04T02:00:00.000Z');
    const thirdChat = await createChat('2026-11-04T03:00:00.000Z');
    const outsiderChat = await createChat('2026-11-04T04:00:00.000Z', {
      requesterId: outsiderId,
      courierId: randomUUID(),
    });
    await archiveChat(firstChat, '2026-11-06T02:00:00.000600Z');
    await archiveChat(secondChat, '2026-11-06T02:00:00.000400Z');
    await archiveChat(thirdChat, '2026-11-06T02:00:00.000400Z');
    await archiveChat(outsiderChat, '2026-11-06T03:00:00.000000Z');
    const expected = await dataSource.query<Array<{ id: string }>>(
      `SELECT id
         FROM chat_archives
        WHERE requester_user_id = $1 OR courier_user_id = $1
        ORDER BY archived_at DESC, id DESC`,
      [requesterId],
    );

    const actual: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await queries.listArchives(requesterId, cursor, 1);
      actual.push(...page.items.map(({ archiveId }) => archiveId));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    expect(actual).toEqual(expected.map(({ id }) => id));
    expect(new Set(actual).size).toBe(expected.length);
    expect(
      (await queries.listArchives(courierId, undefined, 20)).items,
    ).toHaveLength(3);
    expect(
      (await queries.listArchives(outsiderId, undefined, 20)).items,
    ).toHaveLength(1);
  });

  it('returns validated archive detail to either participant without existence leakage', async () => {
    const chatId = await createChat('2026-11-04T01:00:00.000Z');
    const archiveId = await archiveChat(chatId, '2026-11-06T02:00:00.000Z', [
      {
        role: 'REQUESTER',
        content: 'Please leave it at the lobby',
        timestamp: '2026-11-04T01:01:00.000Z',
      },
      {
        role: 'COURIER',
        content: 'Done',
        timestamp: '2026-11-04T01:02:00.000Z',
      },
    ]);

    await expect(
      queries.archiveDetail(requesterId, archiveId),
    ).resolves.toMatchObject({
      archiveId,
      chatId,
      schemaVersion: 1,
      messages: [
        { role: 'REQUESTER', content: 'Please leave it at the lobby' },
        { role: 'COURIER', content: 'Done' },
      ],
    });
    await expect(
      queries.archiveDetail(courierId, archiveId),
    ).resolves.toMatchObject({ archiveId });

    const expected = new NotFoundException({
      code: 'ARCHIVE_NOT_FOUND',
      message: 'Archive not found',
    });
    await expect(queries.archiveDetail(outsiderId, archiveId)).rejects.toEqual(
      expected,
    );
    await expect(
      queries.archiveDetail(requesterId, randomUUID()),
    ).rejects.toEqual(expected);
  });
});
