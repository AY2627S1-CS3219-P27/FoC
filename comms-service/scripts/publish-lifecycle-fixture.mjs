import { readFile } from 'node:fs/promises';
import 'dotenv/config';
import {
  lifecycleFixtureManifest,
  publishFixture,
  resolveFixtureRequest,
} from './lifecycle-fixture-publisher.mjs';

const request = resolveFixtureRequest(process.argv.slice(2));
if (request.list) {
  console.log(Object.keys(lifecycleFixtureManifest).join('\n'));
  process.exit(0);
}

const body = await readFile(request.fixturePath);
await publishFixture({
  url: process.env.RABBITMQ_FIXTURE_URL,
  exchange: 'foc.events',
  routingKey: request.routingKey,
  body,
});
const event = JSON.parse(body.toString('utf8'));
console.log(
  `Published ${String(event.eventType)} ${String(event.eventId)} to ` +
    `foc.events:${request.routingKey}`,
);
