export interface OutboxPublication {
  eventId: string;
  eventType: string;
  routingKey: string;
  envelope: Record<string, unknown>;
}

export interface ClaimedOutboxEvent extends OutboxPublication {
  createdAt: Date;
  attemptCount: number;
  lastError: string | null;
}
