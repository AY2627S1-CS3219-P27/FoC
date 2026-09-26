import type { AnySchemaObject } from 'ajv';

declare const payloadType: unique symbol;

export interface EventContractDefinition<
  TRoutingKey extends string = string,
  TEventType extends string = string,
  TPublisher extends string = string,
  TPayload extends object = Record<string, unknown>,
> {
  routingKey: TRoutingKey;
  eventType: TEventType;
  publisher: TPublisher;
  schema: AnySchemaObject;
  readonly [payloadType]?: TPayload;
}

export type EventContractPayload<TContract> =
  TContract extends EventContractDefinition<
    string,
    string,
    string,
    infer TPayload
  >
    ? TPayload
    : never;

/** Defines runtime event metadata while retaining its payload type only in TypeScript. */
export function defineEventContract<TPayload extends object>() {
  return <
    const TRoutingKey extends string,
    const TEventType extends string,
    const TPublisher extends string,
  >(
    definition: Omit<
      EventContractDefinition<TRoutingKey, TEventType, TPublisher, TPayload>,
      typeof payloadType
    >,
  ): EventContractDefinition<TRoutingKey, TEventType, TPublisher, TPayload> =>
    definition;
}
