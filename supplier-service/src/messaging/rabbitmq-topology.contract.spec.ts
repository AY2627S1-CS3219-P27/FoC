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

interface BrokerPermissionDefinition {
  configure: string;
  read: string;
  user: string;
  vhost: string;
  write: string;
}

interface BrokerUserDefinition {
  name: string;
  hashing_algorithm: string;
  tags: string[];
}

interface BrokerDefinitions {
  exchanges: BrokerExchangeDefinition[];
  queues: BrokerQueueDefinition[];
  bindings: BrokerBindingDefinition[];
  permissions: BrokerPermissionDefinition[];
  users: BrokerUserDefinition[];
}

// The shared broker setup, checked as credit-service checks its own.
const definitions = JSON.parse(
  readFileSync(
    new URL('../../../rabbitmq/definitions.json', import.meta.url),
    'utf8',
  ),
) as BrokerDefinitions;

const queue = (name: string): BrokerQueueDefinition => ({
  arguments: {},
  auto_delete: false,
  durable: true,
  name,
  type: 'classic',
  vhost: '/foc',
});

const binding = (
  destination: string,
  routingKey: string,
): BrokerBindingDefinition => ({
  arguments: {},
  destination,
  destination_type: 'queue',
  routing_key: routingKey,
  source: 'foc.events',
  vhost: '/foc',
});

describe('Supplier Service predeclared RabbitMQ topology (F15.7)', () => {
  it('has its own broker user, limited to its own exchanges and queues (F13.7)', () => {
    expect(
      definitions.users.find(({ name }) => name === 'supplier-service'),
    ).toMatchObject({
      hashing_algorithm: 'rabbit_password_hashing_sha256',
      tags: [],
    });

    const [permission] = definitions.permissions.filter(
      ({ user }) => user === 'supplier-service',
    );
    expect(permission.vhost).toBe('/foc');
    const configure = new RegExp(permission.configure);
    const write = new RegExp(permission.write);
    const read = new RegExp(permission.read);
    // Its own retry topology and queues, created by the consumer at startup.
    for (const name of [
      'foc.supplier.retry',
      'foc.supplier.back',
      'foc.supplier.dlx',
      'supplier-service.order-supplier-validation-requested.v1',
      'supplier-service.order-supplier-validation-requested.v1.dlq',
    ]) {
      expect(configure.test(name)).toBe(true);
      expect(read.test(name)).toBe(true);
    }
    // Publishes replies on, and reads requests from, the shared exchange,
    expect(write.test('foc.events')).toBe(true);
    expect(read.test('foc.events')).toBe(true);
    // but cannot touch other services' exchanges or queues.
    for (const name of [
      'foc.credit.retry',
      'order-service.supplier-validation-completed.v1',
      'credit-service.user-registered.v1',
    ]) {
      expect(configure.test(name)).toBe(false);
      expect(read.test(name)).toBe(false);
    }
  });

  it('predeclares its request queue and binding, and no exchange of its own', () => {
    expect(
      definitions.queues.filter(({ name }) =>
        name.startsWith('supplier-service.'),
      ),
    ).toEqual([
      queue('supplier-service.order-supplier-validation-requested.v1'),
    ]);
    expect(
      definitions.exchanges.filter(({ name }) =>
        name.startsWith('foc.supplier.'),
      ),
    ).toEqual([]);
    expect(
      definitions.bindings.filter(({ destination }) =>
        destination.startsWith('supplier-service.'),
      ),
    ).toEqual([
      binding(
        'supplier-service.order-supplier-validation-requested.v1',
        'order.supplier-validation-requested.v1',
      ),
    ]);
  });

  it("routes the reply to Order Service's queue, which order-service may read", () => {
    const replyQueue = 'order-service.supplier-validation-completed.v1';
    expect(definitions.queues).toContainEqual(queue(replyQueue));
    expect(definitions.bindings).toContainEqual(
      binding(replyQueue, 'supplier.validation-completed.v1'),
    );

    const [order] = definitions.permissions.filter(
      ({ user }) => user === 'order-service',
    );
    expect(new RegExp(order.read).test(replyQueue)).toBe(true);
    expect(new RegExp(order.write).test('foc.events')).toBe(true);
  });
});
