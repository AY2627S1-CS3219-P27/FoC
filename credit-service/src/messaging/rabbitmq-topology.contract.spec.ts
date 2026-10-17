import { readFileSync } from 'node:fs';

interface BrokerQueueDefinition {
  arguments: Record<string, unknown>;
  auto_delete: boolean;
  durable: boolean;
  name: string;
  type: string;
  vhost: string;
}

interface BrokerExchangeDefinition {
  name: string;
  vhost: string;
}

interface BrokerBindingDefinition {
  arguments: Record<string, unknown>;
  destination: string;
  destination_type: string;
  routing_key: string;
  source: string;
  vhost: string;
}

interface BrokerDefinitions {
  exchanges: BrokerExchangeDefinition[];
  queues: BrokerQueueDefinition[];
  bindings: BrokerBindingDefinition[];
}

const definitions = JSON.parse(
  readFileSync(
    new URL('../../../rabbitmq/definitions.json', import.meta.url),
    'utf8',
  ),
) as BrokerDefinitions;

describe('Credit Service predeclared RabbitMQ topology', () => {
  it('predeclares every critical Credit Service ingress queue and binding', () => {
    const creditQueues = definitions.queues.filter(({ name }) =>
      name.startsWith('credit-service.'),
    );
    const creditExchanges = definitions.exchanges.filter(({ name }) =>
      name.startsWith('foc.credit.'),
    );
    const creditBindings = definitions.bindings.filter(({ destination }) =>
      destination.startsWith('credit-service.'),
    );

    expect(creditQueues).toEqual([
      {
        arguments: {},
        auto_delete: false,
        durable: true,
        name: 'credit-service.user-registered.v1',
        type: 'classic',
        vhost: '/foc',
      },
      {
        arguments: {},
        auto_delete: false,
        durable: true,
        name: 'credit-service.credit-reservation.v1',
        type: 'classic',
        vhost: '/foc',
      },
      {
        arguments: {},
        auto_delete: false,
        durable: true,
        name: 'credit-service.credit-reservation-adjustment.v1',
        type: 'classic',
        vhost: '/foc',
      },
      {
        arguments: {},
        auto_delete: false,
        durable: true,
        name: 'credit-service.order-errand-completed.v1',
        type: 'classic',
        vhost: '/foc',
      },
      {
        arguments: {},
        auto_delete: false,
        durable: true,
        name: 'credit-service.order-errand-cancelled.v1',
        type: 'classic',
        vhost: '/foc',
      },
    ]);
    expect(creditExchanges).toEqual([]);
    expect(creditBindings).toEqual([
      {
        arguments: {},
        destination: 'credit-service.user-registered.v1',
        destination_type: 'queue',
        routing_key: 'user.registered.v1',
        source: 'foc.events',
        vhost: '/foc',
      },
      {
        arguments: {},
        destination: 'credit-service.credit-reservation.v1',
        destination_type: 'queue',
        routing_key: 'credit.reservation.v1',
        source: 'foc.events',
        vhost: '/foc',
      },
      {
        arguments: {},
        destination: 'credit-service.credit-reservation-adjustment.v1',
        destination_type: 'queue',
        routing_key: 'credit.reservation-adjustment.v1',
        source: 'foc.events',
        vhost: '/foc',
      },
      {
        arguments: {},
        destination: 'credit-service.order-errand-completed.v1',
        destination_type: 'queue',
        routing_key: 'order.errand-completed.v1',
        source: 'foc.events',
        vhost: '/foc',
      },
      {
        arguments: {},
        destination: 'credit-service.order-errand-cancelled.v1',
        destination_type: 'queue',
        routing_key: 'order.errand-cancelled.v1',
        source: 'foc.events',
        vhost: '/foc',
      },
    ]);
  });

  it('routes both transfer outcomes to their Order Service queues', () => {
    const transferQueues = definitions.queues.filter(({ name }) =>
      name.startsWith('order-service.credit-transfer-'),
    );
    const transferBindings = definitions.bindings.filter(({ destination }) =>
      destination.startsWith('order-service.credit-transfer-'),
    );

    expect(transferQueues).toEqual([
      {
        arguments: {},
        auto_delete: false,
        durable: true,
        name: 'order-service.credit-transfer-succeeded.v1',
        type: 'classic',
        vhost: '/foc',
      },
      {
        arguments: {},
        auto_delete: false,
        durable: true,
        name: 'order-service.credit-transfer-rejected.v1',
        type: 'classic',
        vhost: '/foc',
      },
    ]);
    expect(transferBindings).toEqual([
      {
        arguments: {},
        destination: 'order-service.credit-transfer-succeeded.v1',
        destination_type: 'queue',
        routing_key: 'credit.transfer-succeeded.v1',
        source: 'foc.events',
        vhost: '/foc',
      },
      {
        arguments: {},
        destination: 'order-service.credit-transfer-rejected.v1',
        destination_type: 'queue',
        routing_key: 'credit.transfer-rejected.v1',
        source: 'foc.events',
        vhost: '/foc',
      },
    ]);
  });

  it('routes release rejection without declaring an unused success queue', () => {
    const releaseQueues = definitions.queues.filter(({ name }) =>
      name.startsWith('order-service.credit-release-'),
    );
    const releaseBindings = definitions.bindings.filter(
      ({ destination, routing_key: routingKey }) =>
        destination.startsWith('order-service.credit-release-') ||
        routingKey === 'credit.release-success.v1',
    );

    expect(releaseQueues).toEqual([
      {
        arguments: {},
        auto_delete: false,
        durable: true,
        name: 'order-service.credit-release-rejected.v1',
        type: 'classic',
        vhost: '/foc',
      },
    ]);
    expect(releaseBindings).toEqual([
      {
        arguments: {},
        destination: 'order-service.credit-release-rejected.v1',
        destination_type: 'queue',
        routing_key: 'credit.release-rejected.v1',
        source: 'foc.events',
        vhost: '/foc',
      },
    ]);
  });
});
