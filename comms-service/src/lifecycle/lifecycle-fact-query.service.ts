import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { ChatLifecycleEvent } from '../database/entities/index.js';

export interface AcceptedChatIdentity {
  errandId: string;
  requesterUserId: string;
  courierUserId: string;
  acceptedAt: Date;
}

/** Query boundary reused by Package 4's monotonic deadline transaction. */
@Injectable()
export class LifecycleFactQueryService {
  constructor(private readonly dataSource: DataSource) {}

  findApplicableTerminalFacts(
    accepted: AcceptedChatIdentity,
    within?: EntityManager,
  ): Promise<ChatLifecycleEvent[]> {
    const repository = (within ?? this.dataSource.manager).getRepository(
      ChatLifecycleEvent,
    );
    return repository
      .createQueryBuilder('fact')
      .where('fact.errand_id = :errandId', { errandId: accepted.errandId })
      .andWhere('fact.occurred_at >= :acceptedAt', {
        acceptedAt: accepted.acceptedAt,
      })
      .andWhere(
        `(
          fact.kind = 'ERRAND_CANCELLED'
          OR (
            fact.kind IN ('ERRAND_DELIVERED', 'COURIER_CANCELLED')
            AND fact.requester_user_id = :requesterUserId
            AND fact.courier_user_id = :courierUserId
          )
        )`,
        {
          requesterUserId: accepted.requesterUserId,
          courierUserId: accepted.courierUserId,
        },
      )
      .orderBy('fact.occurred_at', 'ASC')
      .addOrderBy('fact.source_event_id', 'ASC')
      .getMany();
  }
}
