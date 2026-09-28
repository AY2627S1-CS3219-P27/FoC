import type {
  RecoveringChannelModel,
  RecoveryOptions,
  SocketOptions,
} from 'amqplib';
import { connect } from 'amqplib';

/** Injection boundary that keeps broker access replaceable in transport tests. */
export const AMQP_CONNECT = Symbol('AMQP_CONNECT');

export type AmqpConnect = (
  url: string,
  options: SocketOptions & { recovery: RecoveryOptions | true },
) => Promise<RecoveringChannelModel>;

export const amqpConnectionProvider = {
  provide: AMQP_CONNECT,
  useValue: connect as AmqpConnect,
};
