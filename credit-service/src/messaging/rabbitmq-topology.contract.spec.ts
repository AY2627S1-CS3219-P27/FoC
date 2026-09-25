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
  it('predeclares only the critical UserRegistered ingress queue and binding', () => {
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
    ]);
  });
});
