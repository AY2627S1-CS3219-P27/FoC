import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreditTransactionHistoryQueryDto } from './credits.dto.js';

describe('CreditTransactionHistoryQueryDto', () => {
  it('defaults to the shared pagination values', async () => {
    const query = plainToInstance(CreditTransactionHistoryQueryDto, {});

    expect(await validate(query)).toEqual([]);
    expect(query).toMatchObject({ offset: 0, limit: 25 });
  });

  it('coerces valid integer query strings', async () => {
    const query = plainToInstance(CreditTransactionHistoryQueryDto, {
      offset: '50',
      limit: '1000',
    });

    expect(await validate(query)).toEqual([]);
    expect(query).toMatchObject({ offset: 50, limit: 1000 });
  });

  it.each([
    [{ offset: '-1' }, 'offset'],
    [{ offset: '1.5' }, 'offset'],
    [{ limit: '0' }, 'limit'],
    [{ limit: '1001' }, 'limit'],
    [{ limit: 'not-a-number' }, 'limit'],
  ])('rejects invalid pagination %#', async (input, field) => {
    const errors = await validate(
      plainToInstance(CreditTransactionHistoryQueryDto, input),
    );

    expect(errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: field })]),
    );
  });
});
