import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  COMMS_DEAD_LETTER_EXCHANGE,
  COMMS_DOMAIN_EXCHANGE,
  COMMS_EVENTS_QUEUE,
  COMMS_PUBSUB_EXCHANGE,
  COMMS_RETRY_EXCHANGE,
  COMMS_RETRY_RETURN_EXCHANGE,
} from './rabbitmq-topology.js';

interface QueueDefinition {
  arguments: Record<string, unknown>;
  auto_delete: boolean;
  durable: boolean;
  name: string;
  type: string;
  vhost: string;
}

interface BindingDefinition {
  arguments: Record<string, unknown>;
  destination: string;
  destination_type: string;
  routing_key: string;
  source: string;
  vhost: string;
}

interface PermissionDefinition {
  configure: string;
  read: string;
  user: string;
  vhost: string;
  write: string;
}

interface UserDefinition {
  hashing_algorithm: string;
  name: string;
  password_hash: string;
  tags: string[];
}

interface BrokerDefinitions {
  bindings: BindingDefinition[];
  exchanges: Array<{ name: string }>;
  permissions: PermissionDefinition[];
  policies: Array<{ pattern: string; vhost: string }>;
  queues: QueueDefinition[];
  users: UserDefinition[];
}

const definitions = JSON.parse(
  readFileSync(
    new URL('../../../rabbitmq/definitions.json', import.meta.url),
    'utf8',
  ),
) as BrokerDefinitions;

const serviceQueues = definitions.queues.filter(({ name }) =>
  name.startsWith('comms-service.'),
);
const serviceBindings = definitions.bindings.filter(({ destination }) =>
  destination.startsWith('comms-service.'),
);

describe('Communication Service RabbitMQ topology boundary', () => {
  it('defines a non-administrator identity whose example password matches its hash', () => {
    const user = definitions.users.find(({ name }) => name === 'comms-service');
    expect(user).toBeDefined();
    expect(user?.tags).toEqual([]);
    expect(user?.hashing_algorithm).toBe('rabbit_password_hashing_sha256');

    const password = readFileSync(
      new URL(
        '../../secrets/rabbitmq_password.secret.example',
        import.meta.url,
      ),
      'utf8',
    ).replace(/[\r\n]+$/, '');
    const encoded = Buffer.from(user!.password_hash, 'base64');
    const salt = encoded.subarray(0, 4);
    const expectedDigest = createHash('sha256')
      .update(Buffer.concat([salt, Buffer.from(password)]))
      .digest();
    expect(encoded.subarray(4).equals(expectedDigest)).toBe(true);
  });

  it('uses a strict split between primary and service-owned resources', () => {
    const permission = definitions.permissions.find(
      ({ user }) => user === 'comms-service',
    );
    expect(permission).toEqual({
      configure:
        '^(foc\\.comms\\.(retry|back|dlx)|comms-service\\.events(\\.retry\\.[1-5]|\\.dlq)?)$',
      read: '^(foc\\.pubsub|foc\\.comms\\.(retry|back|dlx)|comms-service\\.events(\\.retry\\.[1-5]|\\.dlq)?)$',
      user: 'comms-service',
      vhost: '/foc',
      write:
        '^(foc\\.comms\\.(retry|back|dlx)|comms-service\\.events(\\.retry\\.[1-5]|\\.dlq)?)$',
    });

    const configure = new RegExp(permission!.configure);
    const read = new RegExp(permission!.read);
    const write = new RegExp(permission!.write);
    expect(configure.test(COMMS_EVENTS_QUEUE)).toBe(true);
    expect(read.test(COMMS_EVENTS_QUEUE)).toBe(true);
    expect(write.test(COMMS_EVENTS_QUEUE)).toBe(true);
    expect(configure.test(`${COMMS_EVENTS_QUEUE}.retry.1`)).toBe(true);
    expect(configure.test(`${COMMS_EVENTS_QUEUE}.dlq`)).toBe(true);
    expect(write.test(COMMS_RETRY_EXCHANGE)).toBe(true);
    expect(write.test(COMMS_RETRY_RETURN_EXCHANGE)).toBe(true);
    expect(write.test(COMMS_DEAD_LETTER_EXCHANGE)).toBe(true);
    expect(configure.test(COMMS_DOMAIN_EXCHANGE)).toBe(false);
    expect(read.test(COMMS_DOMAIN_EXCHANGE)).toBe(false);
    expect(write.test(COMMS_DOMAIN_EXCHANGE)).toBe(false);
    expect(configure.test(COMMS_PUBSUB_EXCHANGE)).toBe(false);
    expect(read.test(COMMS_PUBSUB_EXCHANGE)).toBe(true);
    expect(write.test(COMMS_PUBSUB_EXCHANGE)).toBe(false);
    expect(write.test('foc.credit.retry')).toBe(false);
    expect(write.test('credit-service.order-errand-cancelled.v1')).toBe(false);
  });

  it('does not pre-provision service-owned queues', () => {
    expect(serviceQueues).toEqual([]);
  });

  it('does not pre-provision service-owned bindings', () => {
    expect(serviceBindings).toEqual([]);
  });

  it('leaves all retry exchanges, retry queues, DLQs, and internal bindings to the service', () => {
    expect(
      definitions.exchanges.filter(({ name }) => name.startsWith('foc.comms.')),
    ).toEqual([]);
    expect(serviceQueues.some(({ name }) => name.includes('.retry.'))).toBe(
      false,
    );
    expect(serviceQueues.some(({ name }) => name.endsWith('.dlq'))).toBe(false);
    expect(
      serviceBindings.some(({ source }) => source.startsWith('foc.comms.')),
    ).toBe(false);
  });

  it('has no maximum-length, silent-overflow, or policy-based loss configuration', () => {
    for (const queue of serviceQueues) {
      expect(queue.arguments).not.toHaveProperty('x-max-length');
      expect(queue.arguments).not.toHaveProperty('x-max-length-bytes');
      expect(queue.arguments).not.toHaveProperty('x-overflow');
    }
    expect(
      definitions.policies.filter(
        ({ pattern, vhost }) =>
          vhost === '/foc' && new RegExp(pattern).test('comms-service.test'),
      ),
    ).toEqual([]);
  });
});
