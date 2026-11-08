import { randomUUID } from 'node:crypto';
import type { ErrandAcceptedEvent } from '@foc/contracts';
import { DataSource } from 'typeorm';
import { ChatCursorCodec } from '../src/chats/chat-cursor.codec.js';
import { ChatQueryService } from '../src/chats/chat-query.service.js';
import { MessageCommandService } from '../src/chats/message-command.service.js';
import { ReadCommandService } from '../src/chats/read-command.service.js';
import { createDatabaseOptions } from '../src/database/database-options.js';
import { LifecycleFactQueryService } from '../src/lifecycle/lifecycle-fact-query.service.js';
import { LifecycleIngestionService } from '../src/lifecycle/lifecycle-ingestion.service.js';
import { ChatAdmissionService } from '../src/socket/chat-admission.service.js';

describe('authoritative live-operation deadline', () => {
  let dataSource: DataSource;
  let admission: ChatAdmissionService;
  let queries: ChatQueryService;
  let ingestion: LifecycleIngestionService;
  let messages: MessageCommandService;
  let reads: ReadCommandService;

  const requesterId = randomUUID();
  const courierId = randomUUID();
  const outsiderId = randomUUID();

  beforeAll(async () => {
    if (
      process.env.NODE_ENV !== 'test' ||
      !process.env.DB_DATABASE?.endsWith('_test')
    ) {
      throw new Error(
        'Deadline integration tests require a disposable *_test database',
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
    admission = new ChatAdmissionService(dataSource);
    queries = new ChatQueryService(dataSource, new ChatCursorCodec());
    messages = new MessageCommandService(dataSource);
    reads = new ReadCommandService(dataSource);
    ingestion = new LifecycleIngestionService(
      dataSource,
      new LifecycleFactQueryService(dataSource),
    );
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

  async function createChat(): Promise<string> {
    const event: ErrandAcceptedEvent = {
      eventId: randomUUID(),
      eventType: 'ErrandAccepted',
      timestamp: '2026-11-06T00:00:00.000Z',
      publisher: 'order-service',
      payload: {
        errandId: randomUUID(),
        requesterUserId: requesterId,
        courierUserId: courierId,
      },
    };
    const result = await ingestion.process(event, 'order.errand-accepted.v1');
    if (result.status !== 'recorded' || result.chatId === undefined) {
      throw new Error('Expected accepted event to create a chat');
    }
    return result.chatId;
  }

  it('admits only unexpired live chats while retaining expired live history', async () => {
    const chatId = await createChat();
    await dataSource.query(
      `UPDATE chats
          SET state = 'GRACE',
              closes_at = clock_timestamp() + interval '1 hour',
              close_reason = 'ERRAND_DELIVERED'
        WHERE id = $1`,
      [chatId],
    );

    await expect(
      admission.authorize(requesterId, chatId),
    ).resolves.toMatchObject({
      chatId,
      state: 'GRACE',
      closeReason: 'ERRAND_DELIVERED',
    });
    await expect(admission.authorize(outsiderId, chatId)).rejects.toMatchObject(
      {
        code: 'NOT_FOUND',
      },
    );

    await dataSource.query(
      `UPDATE chats
          SET closes_at = clock_timestamp()
        WHERE id = $1`,
      [chatId],
    );

    await expect(
      admission.authorize(requesterId, chatId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      queries.history(requesterId, chatId, undefined, 20),
    ).resolves.toEqual({ items: [], hasMore: false, nextCursor: null });
  });

  it('rechecks database time after waiting for the shared chat lock', async () => {
    const chatId = await createChat();
    await messages.send({
      chatId,
      senderUserId: courierId,
      clientMessageId: randomUUID(),
      content: 'committed before grace expires',
    });
    await dataSource.query(
      `UPDATE chats
          SET state = 'GRACE',
              closes_at = clock_timestamp() + interval '1500 milliseconds',
              close_reason = 'ERRAND_DELIVERED'
        WHERE id = $1`,
      [chatId],
    );

    const blocker = dataSource.createQueryRunner();
    await blocker.connect();
    await blocker.startTransaction();
    try {
      await blocker.query('SELECT id FROM chats WHERE id = $1 FOR UPDATE', [
        chatId,
      ]);
      const sendResult = messages
        .send({
          chatId,
          senderUserId: requesterId,
          clientMessageId: randomUUID(),
          content: 'must not commit after waiting',
        })
        .catch((error: unknown) => error);
      const readResult = reads
        .markRead({
          chatId,
          readerUserId: requesterId,
          throughSequence: 1,
        })
        .catch((error: unknown) => error);

      await new Promise((resolve) => setTimeout(resolve, 1_700));
      await blocker.commitTransaction();

      await expect(sendResult).resolves.toMatchObject({
        code: 'CHAT_ARCHIVED',
      });
      await expect(readResult).resolves.toMatchObject({
        code: 'CHAT_ARCHIVED',
      });
    } finally {
      if (blocker.isTransactionActive) await blocker.rollbackTransaction();
      await blocker.release();
    }

    const [state] = await dataSource.query<
      Array<{
        next_sequence: string;
        message_count: string;
        read_at: Date | null;
      }>
    >(
      `SELECT chat.next_sequence::text AS next_sequence,
              count(message.id)::text AS message_count,
              min(message.read_at) AS read_at
         FROM chats chat
         LEFT JOIN messages message ON message.chat_id = chat.id
        WHERE chat.id = $1
        GROUP BY chat.next_sequence`,
      [chatId],
    );
    expect(state).toEqual({
      next_sequence: '2',
      message_count: '1',
      read_at: null,
    });
  });
});
