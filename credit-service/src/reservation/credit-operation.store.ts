import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { CreditOperationType } from '../database/entities/index.js';

export interface ClaimedCreditOperation {
  id: string;
  operationType: CreditOperationType;
  createdAt: Date;
  attemptCount: number;
  lastError: string | null;
}

/** Owns short claim and retry-metadata transactions around operation work. */
@Injectable()
export class CreditOperationStore {
  constructor(private readonly dataSource: DataSource) {}

  async claim(
    workerId: string,
    batchSize: number,
    leaseMilliseconds: number,
  ): Promise<ClaimedCreditOperation[]> {
    const [rows] = await this.dataSource.query<
      [ClaimedCreditOperation[], number]
    >(
      `
        WITH candidates AS (
          SELECT id
          FROM credit_operations
          WHERE operation_type IN ('RESERVE', 'ADJUST')
            AND status = 'PENDING'
            AND next_attempt_at <= clock_timestamp()
            AND (claimed_until IS NULL OR claimed_until <= clock_timestamp())
          ORDER BY next_attempt_at ASC, created_at ASC, id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $1
        )
        UPDATE credit_operations AS operation
        SET claimed_by = $2,
            claimed_until = clock_timestamp() + ($3::bigint * INTERVAL '1 millisecond'),
            attempt_count = operation.attempt_count + 1,
            updated_at = clock_timestamp()
        FROM candidates
        WHERE operation.id = candidates.id
        RETURNING operation.id,
                  operation.operation_type AS "operationType",
                  operation.created_at AS "createdAt",
                  operation.attempt_count AS "attemptCount",
                  operation.last_error AS "lastError"
      `,
      [batchSize, workerId, leaseMilliseconds],
    );
    return rows;
  }

  async markFailed(
    operationId: string,
    workerId: string,
    failure: string,
    retryDelayMilliseconds: number,
  ): Promise<boolean> {
    const [rows] = await this.dataSource.query<[Array<{ id: string }>, number]>(
      `
        UPDATE credit_operations
        SET last_error = $3,
            claimed_by = NULL,
            claimed_until = NULL,
            next_attempt_at = clock_timestamp() + ($4::bigint * INTERVAL '1 millisecond'),
            updated_at = clock_timestamp()
        WHERE id = $1
          AND claimed_by = $2
          AND status = 'PENDING'
        RETURNING id
      `,
      [operationId, workerId, failure, retryDelayMilliseconds],
    );
    return rows.length === 1;
  }
}
