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
