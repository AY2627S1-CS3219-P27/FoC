import {
  ORDER_COURIER_CANCELLED_V1_ROUTING_KEY,
  ORDER_ERRAND_ACCEPTED_V1_ROUTING_KEY,
  ORDER_ERRAND_CANCELLED_V1_ROUTING_KEY,
  ORDER_ERRAND_DELIVERED_V1_ROUTING_KEY,
} from '@foc/contracts';

export const COMMS_DOMAIN_EXCHANGE = 'foc.events';
export const COMMS_RETRY_EXCHANGE = 'foc.comms.retry';
export const COMMS_RETRY_RETURN_EXCHANGE = 'foc.comms.back';
export const COMMS_DEAD_LETTER_EXCHANGE = 'foc.comms.dlx';
export const COMMS_RETRY_DELAYS_MS = [
  1_000, 2_000, 4_000, 8_000, 16_000,
] as const;

export const COMMS_LIFECYCLE_STREAMS = [
  {
    queue: 'comms-service.order-errand-accepted.v1',
    routingKey: ORDER_ERRAND_ACCEPTED_V1_ROUTING_KEY,
  },
  {
    queue: 'comms-service.order-errand-delivered.v1',
    routingKey: ORDER_ERRAND_DELIVERED_V1_ROUTING_KEY,
  },
  {
    queue: 'comms-service.order-courier-cancelled.v1',
    routingKey: ORDER_COURIER_CANCELLED_V1_ROUTING_KEY,
  },
  {
    queue: 'comms-service.order-errand-cancelled.v1',
    routingKey: ORDER_ERRAND_CANCELLED_V1_ROUTING_KEY,
  },
] as const;

export const COMMS_LIFECYCLE_QUEUES = COMMS_LIFECYCLE_STREAMS.map(
  ({ queue }) => queue,
);
