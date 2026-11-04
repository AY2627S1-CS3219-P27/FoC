import { randomUUID } from 'node:crypto';
import type { ErrandAcceptedEvent } from '@foc/contracts';
import { DataSource } from 'typeorm';
import { MessageCommandService } from '../src/chats/message-command.service.js';
import { createDatabaseOptions } from '../src/database/database-options.js';
import { LifecycleIngestionService } from '../src/lifecycle/lifecycle-ingestion.service.js';

describe('transactional message commands', () => {
  let dataSource: DataSource;
  let lifecycle: LifecycleIngestionService;
  let messages: MessageCommandService;

  const requesterId = randomUUID();
  const courierId = randomUUID();
  const outsiderId = randomUUID();

  async function createChat(): Promise<string> {
    const event: ErrandAcceptedEvent = {
      eventId: randomUUID(),
      eventType: 'ErrandAccepted',
      timestamp: '2026-11-04T01:00:00.000Z',
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

  beforeAll(async () => {
    if (
      process.env.NODE_ENV !== 'test' ||
      !process.env.DB_DATABASE?.endsWith('_test')
    ) {
      throw new Error(
        'Message integration tests require a disposable *_test database',
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
    lifecycle = new LifecycleIngestionService(dataSource);
    messages = new MessageCommandService(dataSource);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.undoLastMigration({ transaction: 'all' });
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE TABLE chat_archives, messages, chats, chat_lifecycle_events, inbox_events',
    );
  });

  it('serializes concurrent sends into unique gap-free committed sequences', async () => {
    const chatId = await createChat();
    const commands = Array.from({ length: 12 }, (_, index) => ({
      chatId,
      senderUserId: index % 2 === 0 ? requesterId : courierId,
      clientMessageId: randomUUID(),
      content: `message-${index}`,
    }));

    const results = await Promise.all(
      commands.map((command) => messages.send(command)),
    );
    expect(results.every((result) => result.inserted)).toBe(true);
    expect(
      results
        .map((result) => result.message.sequence)
        .sort((left, right) => left - right),
    ).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));

    const rows = await dataSource.query<
      { sequence: string; next_sequence: string }[]
    >(
      `SELECT m.sequence::text AS sequence, c.next_sequence::text AS next_sequence
         FROM messages m
         JOIN chats c ON c.id = m.chat_id
        WHERE m.chat_id = $1
        ORDER BY m.sequence`,
      [chatId],
    );
    expect(rows.map((row) => Number(row.sequence))).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    );
    expect(rows.every((row) => row.next_sequence === '13')).toBe(true);
  });

  it('converges concurrent identical retries on one stored message', async () => {
    const chatId = await createChat();
    const command = {
      chatId,
      senderUserId: requesterId,
      clientMessageId: randomUUID(),
      content: 'retry me',
    };

    const results = await Promise.all([
      messages.send(command),
      messages.send(command),
      messages.send(command),
    ]);
    expect(
      new Set(results.map((result) => result.message.messageId)).size,
    ).toBe(1);
    expect(results.filter((result) => result.inserted)).toHaveLength(1);
    expect(results.filter((result) => !result.inserted)).toHaveLength(2);

    const [count] = await dataSource.query<
      { message_count: string; next_sequence: string }[]
    >(
      `SELECT count(m.id)::text AS message_count,
              c.next_sequence::text AS next_sequence
         FROM chats c
         LEFT JOIN messages m ON m.chat_id = c.id
        WHERE c.id = $1
        GROUP BY c.next_sequence`,
      [chatId],
    );
    expect(count).toEqual({ message_count: '1', next_sequence: '2' });
  });

  it('rejects conflicting retry content and conceals non-participants', async () => {
    const chatId = await createChat();
    const clientMessageId = randomUUID();
    await messages.send({
      chatId,
      senderUserId: requesterId,
      clientMessageId,
      content: 'original',
    });

    await expect(
      messages.send({
        chatId,
        senderUserId: requesterId,
        clientMessageId,
        content: 'changed',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      messages.send({
        chatId,
        senderUserId: outsiderId,
        clientMessageId: randomUUID(),
        content: 'intrusion',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rolls sequence and chat ordering back when the insert fails', async () => {
    const chatId = await createChat();
    const oldUpdatedAt = '2026-01-01T00:00:00.000Z';
    await dataSource.query('UPDATE chats SET updated_at = $2 WHERE id = $1', [
      chatId,
      oldUpdatedAt,
    ]);

    await expect(
      messages.send({
        chatId,
        senderUserId: requesterId,
        clientMessageId: randomUUID(),
        content: '   ',
      }),
    ).rejects.toThrow();

    const [state] = await dataSource.query<
      {
        next_sequence: string;
        updated_at: Date;
        message_count: string;
      }[]
    >(
      `SELECT c.next_sequence::text AS next_sequence,
              c.updated_at,
              count(m.id)::text AS message_count
         FROM chats c
         LEFT JOIN messages m ON m.chat_id = c.id
        WHERE c.id = $1
        GROUP BY c.next_sequence, c.updated_at`,
      [chatId],
    );
    expect(state).toMatchObject({
      next_sequence: '1',
      message_count: '0',
    });
    expect(state!.updated_at.toISOString()).toBe(oldUpdatedAt);
  });

  it('rejects expired grace and archived chats before retry lookup', async () => {
    const chatId = await createChat();
    await dataSource.query(
      `UPDATE chats
          SET state = 'GRACE',
              closes_at = now() - interval '1 second',
              close_reason = 'ERRAND_DELIVERED'
        WHERE id = $1`,
      [chatId],
    );

    await expect(
      messages.send({
        chatId,
        senderUserId: requesterId,
        clientMessageId: randomUUID(),
        content: 'too late',
      }),
    ).rejects.toMatchObject({ code: 'CHAT_ARCHIVED' });
  });
});
