import type { EntityManager } from 'typeorm';
import { CreditOperation } from '../database/entities/index.js';

/**
 * The amount a reservation should hold according to the operation ledger: the
 * latest successful adjustment's new amount, or the original reserve amount
 * when the reward was never adjusted.
 */
export async function ledgerReservedAmount(
  manager: EntityManager,
  errandId: string,
  reserveAmount: number | null,
): Promise<number | null> {
  // Non-locking for the same reason as the reserve read in the callers.
  const adjustment = await manager.getRepository(CreditOperation).findOne({
    where: { errandId, operationType: 'ADJUST', status: 'SUCCEEDED' },
    order: { createdAt: 'DESC' },
  });
  return adjustment?.amount ?? reserveAmount;
}
