export type EventEnvelope<
  TType extends string = string,
  TPublisher extends string = string,
  TPayload extends object = Record<string, unknown>,
> = {
  eventId: string;
  eventType: TType;
  timestamp: string;
  publisher: TPublisher;
  payload: TPayload;
};

export interface UserRegisteredPayload {
  userId: string;
  email: string;
  displayName: string;
}

export type UserRegisteredEvent = EventEnvelope<
  'UserRegistered',
  'user-service',
  UserRegisteredPayload
>;

export interface CreditAccountInitialisedPayload {
  userId: string;
  creditAmountAllocated: number;
  creditAllocationId: string;
}

export type CreditAccountInitialisedEvent = EventEnvelope<
  'CreditAccountInitialised',
  'credit-service',
  CreditAccountInitialisedPayload
>;
