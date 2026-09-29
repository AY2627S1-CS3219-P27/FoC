import { readFileSync } from 'node:fs';
import { envs } from './utils/envs.ts';
import { logger } from './utils/logger.ts';
import amqplib from 'amqplib';
import { assertTopology, ATTEMPT_HEADER, attemptOf } from './utils/topology.ts';
import type { Listener } from './handlers/types.ts';
import { OtpEmailListener } from './handlers/otp.ts';
import { ResetPasswordEmailListener } from './handlers/password-reset.ts';
import { dispatchOutcome } from './handlers/common/dispatcher.ts';

const RABBITMQ_PASS = readFileSync(envs.RABBITMQ_PASSWORD_FILE, 'utf8').trim();

const brokerUrl =
  `amqp://${encodeURIComponent(envs.RABBITMQ_USER)}:` +
  `${encodeURIComponent(RABBITMQ_PASS)}@` +
  `${envs.RABBITMQ_HOST}:${envs.RABBITMQ_PORT}/${encodeURIComponent(envs.RABBITMQ_VHOST)}`;

const emailListeners: Listener[] = [
  OtpEmailListener,
  ResetPasswordEmailListener,
];

(async () => {
  const conn = await amqplib.connect(brokerUrl);

  conn.on('error', (err) => {
    logger.error('Connection error  :' + err);
  });
  conn.on('handler-error', (err, event) => {
    logger.error(`Uncaught exception in connection ${event} listener:` + err);
  });

  const ch1 = await conn.createChannel();
  ch1.on('error', (err) => {
    logger.error('Channel error :' + err);
  });
  ch1.on('handler-error', (err, event) => {
    logger.error(`Uncaught exception in channel ${event} listener:` + err);
  });

  await assertTopology(ch1);

  for (const { queueKey, handler } of emailListeners) {
    ch1.consume(queueKey, async (msg) => {
      if (msg === null) {
        logger.info('Consumer cancelled by server');
        return;
      }

      const attempt = attemptOf(msg.properties.headers?.[ATTEMPT_HEADER]);
      await dispatchOutcome(
        ch1,
        msg,
        attempt,
        await handler(msg.content, attempt),
      );
    });
  }
})();
