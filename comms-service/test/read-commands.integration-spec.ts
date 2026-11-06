import { randomUUID } from 'node:crypto';
import type { ErrandAcceptedEvent } from '@foc/contracts';
import { DataSource, type EntityManager } from 'typeorm';
import { ChatCursorCodec } from '../src/chats/chat-cursor.codec.js';
import { ChatQueryService } from '../src/chats/chat-query.service.js';
import { MessageCommandService } from '../src/chats/message-command.service.js';
import { ReadCommandService } from '../src/chats/read-command.service.js';
import { createDatabaseOptions } from '../src/database/database-options.js';
import { LifecycleFactQueryService } from '../src/lifecycle/lifecycle-fact-query.service.js';
import { LifecycleIngestionService } from '../src/lifecycle/lifecycle-ingestion.service.js';

describe('transactional read commands', () => {
  let dataSource: DataSource;
  let lifecycle: LifecycleIngestionService;
  let messages: MessageCommandService;
  let reads: ReadCommandService;
  let queries: ChatQueryService;

  const requesterId = randomUUID();
  const courierId = randomUUID();
  const outsiderId = randomUUID();

  async function createChat(): Promise<string> {
    const event: ErrandAcceptedEvent = {
      eventId: randomUUID(),
      eventType: 'ErrandAccepted',
      timestamp: '2026-11-05T01:00:00.000Z',
      publisher: 'order-service',
      payload: {
        errandId: randomUUID(),
        requesterUserId: requesterId,
        courierUserId: courierId,
      },
    };
    const result = await lifecycle.process(event, 'order.errand-accepted.v1');
    if (result.status !== 'recorded' || result.chatId === undefined) {
      throw new Error('Expected accepted event to create a chat');
    }
    return result.chatId;
  }

  async function send(
    chatId: string,
    senderUserId: string,
    content: string,
  ): Promise<number> {
    const result = await messages.send({
      chatId,
      senderUserId,
      clientMessageId: randomUUID(),
      content,
    });
    return result.message.sequence;
  }

  beforeAll(async () => {
    if (
      process.env.NODE_ENV !== 'test' ||
      !process.env.DB_DATABASE?.endsWith('_test')
    ) {
      throw new Error(
        'Read integration tests require a disposable *_test database',
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
    lifecycle = new LifecycleIngestionService(
      dataSource,
      new LifecycleFactQueryService(dataSource),
    );
    messages = new MessageCommandService(dataSource);
    reads = new ReadCommandService(dataSource);
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

  it('marks only received messages through the requested sequence and drives unread queries', async () => {
    const chatId = await createChat();
    await send(chatId, courierId, 'received-1');
    await send(chatId, requesterId, 'own-2');
    await send(chatId, courierId, 'received-3');
    await send(chatId, courierId, 'received-4');

    const partial = await reads.markRead({
      chatId,
      readerUserId: requesterId,
      throughSequence: 3,
    });
    expect(partial).toMatchObject({
      data: { highestReadSequence: 3, throughSequence: 3 },
      affectedSenderUserId: courierId,
      changed: true,
    });
    expect(partial.data.readAt).not.toBeNull();

    const rows = await dataSource.query<
      { sequence: string; sender_id: string; read_at: Date | null }[]
    >(
      `SELECT sequence::text, sender_id, read_at
         FROM messages
        WHERE chat_id = $1
        ORDER BY sequence`,
      [chatId],
    );
    expect(rows.map((row) => row.read_at !== null)).toEqual([
      true,
      false,
      true,
      false,
    ]);
    expect(rows[0]!.read_at!.toISOString()).toBe(
      rows[2]!.read_at!.toISOString(),
    );
    expect(rows[1]!.sender_id).toBe(requesterId);
    expect(
      (await queries.list(requesterId, undefined, 20)).items[0]!.unread,
    ).toBe(true);

    await reads.markRead({
      chatId,
      readerUserId: requesterId,
      throughSequence: 4,
    });
    expect(
      (await queries.list(requesterId, undefined, 20)).items[0]!.unread,
    ).toBe(false);
  });

  it('preserves timestamps and emits no changed result for repeated multi-tab reads', async () => {
    const chatId = await createChat();
    await send(chatId, courierId, 'received-1');
    await send(chatId, courierId, 'received-2');
    await send(chatId, courierId, 'received-3');

    const overlapping = await Promise.all([
      reads.markRead({ chatId, readerUserId: requesterId, throughSequence: 2 }),
      reads.markRead({ chatId, readerUserId: requesterId, throughSequence: 3 }),
    ]);
    expect(overlapping.some((result) => result.changed)).toBe(true);
    const before = await dataSource.query<
      { sequence: string; read_at: Date | null }[]
    >(
      `SELECT sequence::text, read_at FROM messages
        WHERE chat_id = $1 ORDER BY sequence`,
      [chatId],
    );
    expect(before.every((row) => row.read_at !== null)).toBe(true);

    const repeated = await Promise.all(
      Array.from({ length: 4 }, () =>
        reads.markRead({
          chatId,
          readerUserId: requesterId,
          throughSequence: 3,
        }),
      ),
    );
    expect(
      repeated.every(
        (result) =>
          !result.changed &&
          result.data.highestReadSequence === null &&
          result.data.readAt === null,
      ),
    ).toBe(true);
    const after = await dataSource.query<
      { sequence: string; read_at: Date | null }[]
    >(
      `SELECT sequence::text, read_at FROM messages
        WHERE chat_id = $1 ORDER BY sequence`,
      [chatId],
    );
    expect(after).toEqual(before);
  });

  it('rejects invalid targets and sequences without changing rows', async () => {
    const chatId = await createChat();
    await send(chatId, courierId, 'received');

    await expect(
      reads.markRead({
        chatId,
        readerUserId: outsiderId,
        throughSequence: 1,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      reads.markRead({
        chatId,
        readerUserId: requesterId,
        throughSequence: 2,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const archiveId = randomUUID();
    await dataSource.query(
      `UPDATE chats
          SET state = 'GRACE', closes_at = now(),
              close_reason = 'ERRAND_DELIVERED'
        WHERE id = $1`,
      [chatId],
    );
    await expect(
      reads.markRead({
        chatId,
        readerUserId: requesterId,
        throughSequence: 1,
      }),
    ).rejects.toMatchObject({ code: 'CHAT_ARCHIVED' });
    const [expiredMessage] = await dataSource.query<{ read_at: Date | null }[]>(
      'SELECT read_at FROM messages WHERE chat_id = $1',
      [chatId],
    );
    expect(expiredMessage!.read_at).toBeNull();

    await dataSource.query(
      `INSERT INTO chat_archives
       (id, chat_id, errand_id, requester_user_id, courier_user_id, snapshot)
       SELECT $2, id, errand_id, requester_user_id, courier_user_id,
              '{"schemaVersion":1}'::jsonb
         FROM chats WHERE id = $1`,
      [chatId, archiveId],
    );
    await dataSource.query(
      `UPDATE chats SET state = 'ARCHIVED', archive_id = $2 WHERE id = $1`,
      [chatId, archiveId],
    );
    await expect(
      reads.markRead({
        chatId,
        readerUserId: requesterId,
        throughSequence: 1,
      }),
    ).rejects.toMatchObject({ code: 'CHAT_ARCHIVED' });
    const [message] = await dataSource.query<{ read_at: Date | null }[]>(
      'SELECT read_at FROM messages WHERE chat_id = $1',
      [chatId],
    );
    expect(message!.read_at).toBeNull();
  });

  it('rolls read timestamps back when the transaction fails after the update', async () => {
    const chatId = await createChat();
    await send(chatId, courierId, 'received');
    const rollbackDataSource = {
      transaction: (
        isolation: 'READ COMMITTED',
        work: (manager: EntityManager) => Promise<unknown>,
      ) =>
        dataSource.transaction(isolation, async (manager) => {
          await work(manager);
          throw new Error('injected failure before commit');
        }),
    } as DataSource;
    const failingReads = new ReadCommandService(rollbackDataSource);

    await expect(
      failingReads.markRead({
        chatId,
        readerUserId: requesterId,
        throughSequence: 1,
      }),
    ).rejects.toThrow('injected failure before commit');
    const [message] = await dataSource.query<{ read_at: Date | null }[]>(
      'SELECT read_at FROM messages WHERE chat_id = $1',
      [chatId],
    );
    expect(message!.read_at).toBeNull();
  });
});
