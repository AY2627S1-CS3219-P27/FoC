import type { DataSource, EntityManager } from 'typeorm';
import { SerializableTransactionRunner } from './serializable-transaction.runner.js';

describe('SerializableTransactionRunner', () => {
  const manager = {} as EntityManager;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('runs work in a serializable transaction', async () => {
    const transaction = vi
      .fn()
      .mockImplementation(
        async (
          isolation: string,
          work: (entityManager: EntityManager) => Promise<string>,
        ) => work(manager),
      );
    const runner = new SerializableTransactionRunner({
      transaction,
    } as unknown as DataSource);
    const work = vi.fn().mockResolvedValue('result');

    await expect(runner.run(work)).resolves.toBe('result');
    expect(transaction).toHaveBeenCalledWith('SERIALIZABLE', work);
    expect(work).toHaveBeenCalledWith(manager);
  });

  it.each(['40001', '40P01'])(
    'retries SQLSTATE %s three times before succeeding',
    async (code) => {
      const transaction = vi
        .fn()
        .mockRejectedValueOnce({ code })
        .mockRejectedValueOnce({ driverError: { code } })
        .mockRejectedValueOnce({ code })
        .mockResolvedValue('result');
      const runner = new SerializableTransactionRunner({
        transaction,
      } as unknown as DataSource);

      const result = runner.run(async () => 'unused');
      await vi.runAllTimersAsync();

      await expect(result).resolves.toBe('result');
      expect(transaction).toHaveBeenCalledTimes(4);
    },
  );

  it('returns the last database error after retry exhaustion', async () => {
    const errors = Array.from({ length: 4 }, (_, index) => ({
      code: '40001',
      attempt: index,
    }));
    const transaction = vi.fn();
    for (const error of errors) {
      transaction.mockRejectedValueOnce(error);
    }
    const runner = new SerializableTransactionRunner({
      transaction,
    } as unknown as DataSource);

    const result = runner.run(async () => 'unused');
    const rejection = expect(result).rejects.toBe(errors[3]);
    await vi.runAllTimersAsync();

    await rejection;
    expect(transaction).toHaveBeenCalledTimes(4);
  });

  it('does not retry a non-transient database error', async () => {
    const error = { code: '23505' };
    const transaction = vi.fn().mockRejectedValue(error);
    const runner = new SerializableTransactionRunner({
      transaction,
    } as unknown as DataSource);

    await expect(runner.run(async () => 'unused')).rejects.toBe(error);
    expect(transaction).toHaveBeenCalledOnce();
  });
});
