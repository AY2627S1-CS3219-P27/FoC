import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MessageHistoryQueryDto } from './chats.dto.js';

describe('MessageHistoryQueryDto', () => {
  it('defaults to forward paging', async () => {
    const query = plainToInstance(MessageHistoryQueryDto, {});

    await expect(validate(query)).resolves.toEqual([]);
    expect(query.direction).toBe('forward');
    expect(query.limit).toBe(20);
  });

  it.each(['forward', 'backward'] as const)(
    'accepts the %s direction',
    async (direction) => {
      const query = plainToInstance(MessageHistoryQueryDto, { direction });

      await expect(validate(query)).resolves.toEqual([]);
      expect(query.direction).toBe(direction);
    },
  );

  it('rejects an unsupported direction', async () => {
    const query = plainToInstance(MessageHistoryQueryDto, {
      direction: 'sideways',
    });

    const errors = await validate(query);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe('direction');
  });
});
