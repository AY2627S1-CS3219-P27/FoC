import 'dotenv/config';
import { io } from 'socket.io-client';
import {
  resolveRealtimeFixtureRequest,
  runRealtimeFixture,
} from './realtime-fixture-runner.mjs';

try {
  const request = resolveRealtimeFixtureRequest(process.argv.slice(2));
  await runRealtimeFixture(request, {
    ioFactory: io,
    log: (message) => console.log(message),
  });
  console.log('Realtime fixture passed');
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown failure';
  console.error(`Realtime fixture failed: ${message}`);
  process.exitCode = 1;
}
