import { NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { ChatCursorCodec } from './chat-cursor.codec.js';
import { ChatQueryService } from './chat-query.service.js';

describe('ChatQueryService', () => {
  const callerId = '11111111-1111-4111-8111-111111111111';
  const chatId = '22222222-2222-4222-8222-222222222222';
  const query = vi.fn();
  const cursors = new ChatCursorCodec();
  const service = new ChatQueryService(
    { query } as unknown as DataSource,
    cursors,
  );

  beforeEach(() => query.mockReset());

  it('lists only participant live chats and returns a stable cursor', async () => {
    query.mockResolvedValue([
      {
        chat_id: chatId,
        errand_id: '33333333-3333-4333-8333-333333333333',
        requester_user_id: callerId,
        courier_user_id: '44444444-4444-4444-8444-444444444444',
        state: 'ACTIVE',
        closes_at: null,
        close_reason: null,
        updated_at: new Date('2026-11-04T02:00:00.000Z'),
        cursor_updated_at: '2026-11-04T02:00:00.000600Z',
        message_id: null,
        sequence: null,
        sender_id: null,
        content: null,
        committed_at: null,
        read_at: null,
        unread: false,
      },
      {
        chat_id: '55555555-5555-4555-8555-555555555555',
        errand_id: '66666666-6666-4666-8666-666666666666',
        requester_user_id: callerId,
        courier_user_id: '77777777-7777-4777-8777-777777777777',
        state: 'GRACE',
        closes_at: new Date('2026-11-05T00:00:00.000Z'),
        close_reason: 'ERRAND_DELIVERED',
        updated_at: new Date('2026-11-04T01:00:00.000Z'),
        cursor_updated_at: '2026-11-04T01:00:00.000400Z',
        message_id: '88888888-8888-4888-8888-888888888888',
        sequence: '2',
        sender_id: '77777777-7777-4777-8777-777777777777',
        content: 'Hello',
        committed_at: new Date('2026-11-04T00:30:00.000Z'),
        read_at: null,
        unread: true,
      },
    ]);

    const result = await service.list(callerId, undefined, 1);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("c.state IN ('ACTIVE', 'GRACE')"),
      [callerId, null, null, 2],
    );
    expect(result).toMatchObject({
      items: [{ chatId, lastMessage: null, unread: false }],
      hasMore: true,
    });
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(cursors.decodeChat(result.nextCursor!)).toEqual({
      updatedAt: '2026-11-04T02:00:00.000600Z',
      chatId,
    });

    query.mockResolvedValueOnce([]);
    await service.list(callerId, result.nextCursor!, 1);
    expect(query).toHaveBeenLastCalledWith(expect.any(String), [
      callerId,
      '2026-11-04T02:00:00.000600Z',
      chatId,
      2,
    ]);
  });

  it('maps history status and paginates by ascending sequence', async () => {
    query.mockResolvedValue([
      {
        authorized: true,
        message_id: '33333333-3333-4333-8333-333333333333',
        sequence: '1',
        sender_id: callerId,
        content: 'One',
        committed_at: new Date('2026-11-04T01:00:00.000Z'),
        read_at: new Date('2026-11-04T01:01:00.000Z'),
      },
      {
        authorized: true,
        message_id: '44444444-4444-4444-8444-444444444444',
        sequence: '2',
        sender_id: callerId,
        content: 'Two',
        committed_at: new Date('2026-11-04T01:02:00.000Z'),
        read_at: null,
      },
    ]);

    const result = await service.history(callerId, chatId, undefined, 1);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('m.sequence > $3::bigint'),
      [chatId, callerId, 0, 2],
    );
    expect(result).toMatchObject({
      items: [{ sequence: 1, status: 'READ' }],
      hasMore: true,
    });
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(cursors.decodeMessages(result.nextCursor!, 'forward')).toBe(1);
  });

  it('returns the latest backward page in ascending order with an older cursor', async () => {
    query.mockResolvedValue([
      {
        authorized: true,
        message_id: '33333333-3333-4333-8333-333333333333',
        sequence: '2',
        sender_id: callerId,
        content: 'Two',
        committed_at: new Date('2026-11-04T01:01:00.000Z'),
        read_at: null,
      },
      {
        authorized: true,
        message_id: '44444444-4444-4444-8444-444444444444',
        sequence: '3',
        sender_id: callerId,
        content: 'Three',
        committed_at: new Date('2026-11-04T01:02:00.000Z'),
        read_at: null,
      },
      {
        authorized: true,
        message_id: '55555555-5555-4555-8555-555555555555',
        sequence: '4',
        sender_id: callerId,
        content: 'Four',
        committed_at: new Date('2026-11-04T01:03:00.000Z'),
        read_at: null,
      },
    ]);

    const result = await service.history(
      callerId,
      chatId,
      undefined,
      2,
      'backward',
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('m.sequence < $3::bigint'),
      [chatId, callerId, null, 3],
    );
    expect(result).toMatchObject({
      items: [{ sequence: 3 }, { sequence: 4 }],
      hasMore: true,
    });
    expect(cursors.decodeMessages(result.nextCursor!, 'backward')).toBe(3);
  });

  it('returns an empty page for an authorized chat with no remaining rows', async () => {
    query.mockResolvedValue([
      {
        authorized: true,
        message_id: null,
        sequence: null,
        sender_id: null,
        content: null,
        committed_at: null,
        read_at: null,
      },
    ]);
    await expect(
      service.history(callerId, chatId, undefined, 20),
    ).resolves.toEqual({ items: [], hasMore: false, nextCursor: null });
  });

  it('uses the same not-found response for absent and unauthorized chats', async () => {
    query.mockResolvedValue([]);
    await expect(
      service.history(callerId, chatId, undefined, 20),
    ).rejects.toEqual(
      new NotFoundException({
        code: 'CHAT_NOT_FOUND',
        message: 'Chat not found',
      }),
    );
  });

  it('lists participant archives with a route-scoped stable cursor', async () => {
    const archiveId = '33333333-3333-4333-8333-333333333333';
    query.mockResolvedValue([
      {
        archive_id: archiveId,
        chat_id: chatId,
        errand_id: '44444444-4444-4444-8444-444444444444',
        requester_user_id: callerId,
        courier_user_id: '55555555-5555-4555-8555-555555555555',
        archived_at: new Date('2026-11-06T02:00:00.000Z'),
        cursor_archived_at: '2026-11-06T02:00:00.000600Z',
      },
      {
        archive_id: '66666666-6666-4666-8666-666666666666',
        chat_id: '77777777-7777-4777-8777-777777777777',
        errand_id: '88888888-8888-4888-8888-888888888888',
        requester_user_id: callerId,
        courier_user_id: '99999999-9999-4999-8999-999999999999',
        archived_at: new Date('2026-11-06T01:00:00.000Z'),
        cursor_archived_at: '2026-11-06T01:00:00.000400Z',
      },
    ]);

    const result = await service.listArchives(callerId, undefined, 1);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        'ORDER BY archive.archived_at DESC, archive.id DESC',
      ),
      [callerId, null, null, 2],
    );
    expect(result).toMatchObject({
      items: [{ archiveId, chatId }],
      hasMore: true,
    });
    expect(cursors.decodeArchive(result.nextCursor!)).toEqual({
      archivedAt: '2026-11-06T02:00:00.000600Z',
      archiveId,
    });

    query.mockResolvedValueOnce([]);
    await service.listArchives(callerId, result.nextCursor!, 1);
    expect(query).toHaveBeenLastCalledWith(expect.any(String), [
      callerId,
      '2026-11-06T02:00:00.000600Z',
      archiveId,
      2,
    ]);
  });

  it('maps a validated immutable archive snapshot', async () => {
    const archiveId = '33333333-3333-4333-8333-333333333333';
    const archivedAt = '2026-11-06T02:00:00.000Z';
    const errandId = '44444444-4444-4444-8444-444444444444';
    const courierId = '55555555-5555-4555-8555-555555555555';
    query.mockResolvedValue([
      {
        archive_id: archiveId,
        chat_id: chatId,
        errand_id: errandId,
        requester_user_id: callerId,
        courier_user_id: courierId,
        archived_at: new Date(archivedAt),
        cursor_archived_at: '2026-11-06T02:00:00.000000Z',
        schema_version: 1,
        snapshot: {
          schemaVersion: 1,
          chatId,
          errandId,
          requesterUserId: callerId,
          courierUserId: courierId,
          archivedAt,
          messages: [
            {
              role: 'REQUESTER',
              content: 'Delivered safely',
              timestamp: '2026-11-06T01:59:00.000Z',
            },
          ],
        },
      },
    ]);

    await expect(service.archiveDetail(callerId, archiveId)).resolves.toEqual({
      archiveId,
      chatId,
      errandId,
      requesterUserId: callerId,
      courierUserId: courierId,
      archivedAt,
      schemaVersion: 1,
      messages: [
        {
          role: 'REQUESTER',
          content: 'Delivered safely',
          timestamp: '2026-11-06T01:59:00.000Z',
        },
      ],
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('archive.id = $1::uuid'),
      [archiveId, callerId],
    );
  });

  it('conceals absent and unauthorized archives and rejects corrupt snapshots', async () => {
    const archiveId = '33333333-3333-4333-8333-333333333333';
    query.mockResolvedValueOnce([]);
    await expect(service.archiveDetail(callerId, archiveId)).rejects.toEqual(
      new NotFoundException({
        code: 'ARCHIVE_NOT_FOUND',
        message: 'Archive not found',
      }),
    );

    query.mockResolvedValueOnce([
      {
        archive_id: archiveId,
        chat_id: chatId,
        errand_id: '44444444-4444-4444-8444-444444444444',
        requester_user_id: callerId,
        courier_user_id: '55555555-5555-4555-8555-555555555555',
        archived_at: new Date('2026-11-06T02:00:00.000Z'),
        cursor_archived_at: '2026-11-06T02:00:00.000000Z',
        schema_version: 1,
        snapshot: { schemaVersion: 1 },
      },
    ]);
    await expect(service.archiveDetail(callerId, archiveId)).rejects.toThrow(
      'Stored archive snapshot failed integrity validation',
    );
  });
});
