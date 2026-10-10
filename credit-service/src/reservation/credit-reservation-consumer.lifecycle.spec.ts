import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';
import type { RabbitMqConsumerTransport } from '../messaging/rabbitmq-consumer.transport.js';
import { CreditReservationAdjustmentConsumerLifecycle } from './credit-reservation-adjustment-consumer.lifecycle.js';
import type { CreditReservationAdjustmentMessageHandler } from './credit-reservation-adjustment-message.handler.js';
import { CreditReservationConsumerLifecycle } from './credit-reservation-consumer.lifecycle.js';
import type { CreditReservationMessageHandler } from './credit-reservation-message.handler.js';

describe('credit reservation consumer lifecycles', () => {
  it('attaches independent reservation and adjustment subscriptions', async () => {
    const subscribe = vi.fn().mockResolvedValue(undefined);
    const reservationHandler = {} as CreditReservationMessageHandler;
    const adjustmentHandler = {} as CreditReservationAdjustmentMessageHandler;
    const values = {
      RABBITMQ_CREDIT_RESERVATION_QUEUE: 'credit-service.credit-reservation.v1',
      RABBITMQ_CREDIT_RESERVATION_ROUTING_KEY: 'credit.reservation.v1',
      RABBITMQ_CREDIT_RESERVATION_ADJUSTMENT_QUEUE:
        'credit-service.credit-reservation-adjustment.v1',
      RABBITMQ_CREDIT_RESERVATION_ADJUSTMENT_ROUTING_KEY:
        'credit.reservation-adjustment.v1',
    };
    const config = {
      getOrThrow: (key: keyof typeof values) => values[key],
    } as ConfigService<EnvironmentVariables, true>;
    const transport = {
      subscribe,
    } as unknown as RabbitMqConsumerTransport;

    await new CreditReservationConsumerLifecycle(
      transport,
      reservationHandler,
      config,
    ).onApplicationBootstrap();
    await new CreditReservationAdjustmentConsumerLifecycle(
      transport,
      adjustmentHandler,
      config,
    ).onApplicationBootstrap();

    expect(subscribe).toHaveBeenNthCalledWith(1, {
      queue: 'credit-service.credit-reservation.v1',
      routingKey: 'credit.reservation.v1',
      handler: reservationHandler,
    });
    expect(subscribe).toHaveBeenNthCalledWith(2, {
      queue: 'credit-service.credit-reservation-adjustment.v1',
      routingKey: 'credit.reservation-adjustment.v1',
      handler: adjustmentHandler,
    });
  });
});
