import { randomUUID } from 'node:crypto';
import type { ErrandAcceptedEvent } from '@foc/contracts';
import type { ConfigService } from '@nestjs/config';
import { DataSource, type EntityManager } from 'typeorm';
import { ArchiveClaimService } from '../src/archive/archive-claim.service.js';
import { ArchiveService } from '../src/archive/archive.service.js';
import { MessageCommandService } from '../src/chats/message-command.service.js';
import type { EnvironmentVariables } from '../src/config/environment.js';
import { createDatabaseOptions } from '../src/database/database-options.js';
import { LifecycleFactQueryService } from '../src/lifecycle/lifecycle-fact-query.service.js';
import { LifecycleIngestionService } from '../src/lifecycle/lifecycle-ingestion.service.js';

describe('leased immutable archive processing', () => {
  let dataSource: DataSource;
  let ingestion: LifecycleIngestionService;
  let messages: MessageCommandService;

  beforeAll(async () => {
    if (
      process.env.NODE_ENV !== 'test' ||
      !process.env.DB_DATABASE?.endsWith('_test')
    ) {
      throw new Error(
        'Archive integration tests require a disposable *_test database',
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
    messages = new MessageCommandService(dataSource);
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

  function claimService(batchSize = 25): ArchiveClaimService {
    const settings = {
      ARCHIVE_BATCH_SIZE: batchSize,
      ARCHIVE_CLAIM_TTL_MS: 60_000,
    };
    return new ArchiveClaimService(dataSource, {
      get: (name: keyof typeof settings) => settings[name],
    } as unknown as ConfigService<EnvironmentVariables, true>);
  }

  async function createChat(): Promise<{
    chatId: string;
    errandId: string;
    requesterUserId: string;
    courierUserId: string;
  }> {
    const event: ErrandAcceptedEvent = {
      eventId: randomUUID(),
      eventType: 'ErrandAccepted',
      timestamp: '2026-11-06T00:00:00.000Z',
      publisher: 'order-service',
      payload: {
        errandId: randomUUID(),
        requesterUserId: randomUUID(),
        courierUserId: randomUUID(),
      },
    };
    const result = await ingestion.process(event, 'order.errand-accepted.v1');
    if (result.status !== 'recorded' || result.chatId === undefined) {
      throw new Error('Expected accepted event to create a chat');
    }
    return { chatId: result.chatId, ...event.payload };
  }

  async function makeDue(chatId: string, offset = '-1 minute'): Promise<void> {
    await dataSource.query(
      `UPDATE chats
          SET state = 'GRACE',
              closes_at = clock_timestamp() + $2::interval,
              close_reason = 'ERRAND_DELIVERED'
        WHERE id = $1`,
      [chatId, offset],
    );
  }

  it('archives the exact ordered chat with one database timestamp', async () => {
    const chat = await createChat();
    const requesterMessage = await messages.send({
      chatId: chat.chatId,
      senderUserId: chat.requesterUserId,
      clientMessageId: randomUUID(),
      content: 'first',
    });
    const courierMessage = await messages.send({
      chatId: chat.chatId,
      senderUserId: chat.courierUserId,
      clientMessageId: randomUUID(),
      content: 'second',
    });
    await makeDue(chat.chatId);
    const [claim] = await claimService().claimDueBatch();
    expect(claim).toBeDefined();

    const result = await new ArchiveService(dataSource).archive(claim!);

    expect(result.status).toBe('archived');
    const [stored] = await dataSource.query<
      Array<{
        archive_id: string;
        state: string;
        archive_claim_token: string | null;
        archived_at: Date;
        snapshot: {
          schemaVersion: number;
          chatId: string;
          errandId: string;
          requesterUserId: string;
          courierUserId: string;
          archivedAt: string;
          messages: Array<{
            role: string;
            content: string;
            timestamp: string;
          }>;
        };
        message_count: string;
      }>
    >(
      `SELECT chat.archive_id,
              chat.state,
              chat.archive_claim_token,
              archive.archived_at,
              archive.snapshot,
              (SELECT count(*)::text FROM messages message
                WHERE message.chat_id = chat.id) AS message_count
         FROM chats chat
         JOIN chat_archives archive ON archive.id = chat.archive_id
        WHERE chat.id = $1`,
      [chat.chatId],
    );
    expect(stored).toMatchObject({
      state: 'ARCHIVED',
      archive_claim_token: null,
      message_count: '0',
      snapshot: {
        schemaVersion: 1,
        chatId: chat.chatId,
        errandId: chat.errandId,
        requesterUserId: chat.requesterUserId,
        courierUserId: chat.courierUserId,
        messages: [
          {
            role: 'REQUESTER',
            content: 'first',
            timestamp: requesterMessage.message.timestamp,
          },
          {
            role: 'COURIER',
            content: 'second',
            timestamp: courierMessage.message.timestamp,
          },
        ],
      },
    });
    expect(stored!.snapshot.archivedAt).toBe(stored!.archived_at.toISOString());
    if (result.status === 'archived') {
      expect(result.notification).toMatchObject({
        chatId: chat.chatId,
        archiveId: stored!.archive_id,
        archivedAt: stored!.archived_at,
      });
    }
  });

  it('allows only one concurrent worker to claim and archive a due chat', async () => {
    const chat = await createChat();
    await makeDue(chat.chatId);

    const batches = await Promise.all([
      claimService().claimDueBatch(),
      claimService().claimDueBatch(),
      claimService().claimDueBatch(),
    ]);
    const claims = batches.flat();
    expect(claims).toHaveLength(1);
    await Promise.all(
      claims.map((claim) => new ArchiveService(dataSource).archive(claim)),
    );

    const [counts] = await dataSource.query<
      Array<{ archives: string; archived_chats: string }>
    >(`
      SELECT
        (SELECT count(*)::text FROM chat_archives) AS archives,
        (SELECT count(*)::text FROM chats WHERE state = 'ARCHIVED') AS archived_chats
    `);
    expect(counts).toEqual({ archives: '1', archived_chats: '1' });
  });

  it('reclaims an expired lease and rejects the obsolete token', async () => {
    const chat = await createChat();
    await makeDue(chat.chatId);
    const oldToken = randomUUID();
    await dataSource.query(
      `UPDATE chats
          SET created_at = clock_timestamp() - interval '2 hours',
              archive_claim_token = $2,
              archive_claim_expires_at = clock_timestamp() - interval '1 hour'
        WHERE id = $1`,
      [chat.chatId, oldToken],
    );

    const [reclaimed] = await claimService().claimDueBatch();

    expect(reclaimed).toMatchObject({ chatId: chat.chatId, reclaimed: true });
    expect(reclaimed!.claimToken).not.toBe(oldToken);
    await expect(
      new ArchiveService(dataSource).archive({
        chatId: chat.chatId,
        claimToken: oldToken,
        reclaimed: false,
      }),
    ).resolves.toEqual({ status: 'stale' });
    await expect(
      new ArchiveService(dataSource).archive(reclaimed!),
    ).resolves.toMatchObject({ status: 'archived' });
  });

  it('rolls back the snapshot and message deletion after an injected failure', async () => {
    const chat = await createChat();
    await messages.send({
      chatId: chat.chatId,
      senderUserId: chat.courierUserId,
      clientMessageId: randomUUID(),
      content: 'must survive rollback',
    });
    await makeDue(chat.chatId);
    const [claim] = await claimService().claimDueBatch();
    const failingDataSource = {
      transaction: (
        isolation: 'READ COMMITTED',
        work: (manager: EntityManager) => Promise<unknown>,
      ) =>
        dataSource.transaction(isolation, async (manager) => {
          await work(manager);
          throw new Error('injected failure before commit');
        }),
    } as DataSource;

    await expect(
      new ArchiveService(failingDataSource).archive(claim!),
    ).rejects.toThrow('injected failure before commit');

    const [state] = await dataSource.query<
      Array<{
        state: string;
        archive_id: string | null;
        archive_claim_token: string;
        messages: string;
        archives: string;
      }>
    >(
      `SELECT chat.state,
              chat.archive_id,
              chat.archive_claim_token,
              (SELECT count(*)::text FROM messages WHERE chat_id = chat.id) AS messages,
              (SELECT count(*)::text FROM chat_archives) AS archives
         FROM chats chat
        WHERE chat.id = $1`,
      [chat.chatId],
    );
    expect(state).toEqual({
      state: 'GRACE',
      archive_id: null,
      archive_claim_token: claim!.claimToken,
      messages: '1',
      archives: '0',
    });
  });

  it('does not claim future grace chats and honors the batch limit', async () => {
    const due = await Promise.all([createChat(), createChat(), createChat()]);
    const future = await createChat();
    for (let index = 0; index < due.length; index += 1) {
      await makeDue(due[index]!.chatId, `-${3 - index} minutes`);
    }
    await makeDue(future.chatId, '1 hour');
    const expected = await dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM chats
        WHERE closes_at <= clock_timestamp()
        ORDER BY closes_at ASC, id ASC
        LIMIT 2`,
    );

    const claims = await claimService(2).claimDueBatch();

    expect(claims.map(({ chatId }) => chatId)).toEqual(
      expected.map(({ id }) => id),
    );
    expect(claims).toHaveLength(2);
    expect(claims.some(({ chatId }) => chatId === future.chatId)).toBe(false);
  });
});
