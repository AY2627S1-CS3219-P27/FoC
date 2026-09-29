import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const serviceDirectory = fileURLToPath(new URL('../', import.meta.url));
const recoveryServices = ['credit-db-recovery', 'credit-rabbitmq-recovery'];
const composeBase = ['compose', '--profile', 'recovery'];
let activeChild;
let interrupted = false;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: serviceDirectory,
      env: options.env ?? process.env,
      stdio: 'inherit',
      shell: false,
    });
    activeChild = child;
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      activeChild = undefined;
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `${command} exited with ${signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`}`,
          ),
        );
      }
    });
  });
}

async function cleanup() {
  await run('docker', [
    ...composeBase,
    'rm',
    '-s',
    '-f',
    '-v',
    ...recoveryServices,
  ]).catch((error) => {
    console.error(`Unable to clean recovery containers: ${error.message}`);
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    interrupted = true;
    activeChild?.kill(signal);
  });
}

let exitCode = 0;
try {
  await run('docker', [
    ...composeBase,
    'up',
    '-d',
    '--wait',
    '--build',
    '--renew-anon-volumes',
    ...recoveryServices,
  ]);

  const username = process.env.RABBITMQ_USERNAME ?? 'credit_service';
  const password = process.env.RABBITMQ_PASSWORD;
  if (!password) {
    throw new Error('RABBITMQ_PASSWORD must be set in credit-service/.env');
  }

  const recoveryEnvironment = {
    ...process.env,
    DB_HOST: '127.0.0.1',
    DB_PORT: process.env.DB_RECOVERY_HOST_PORT ?? '5437',
    DB_USERNAME: process.env.DB_USERNAME ?? 'credit_service',
    DB_DATABASE: 'credit_service_recovery',
    DB_PASSWORD_FILE:
      process.env.RECOVERY_DB_PASSWORD_FILE ??
      './secrets/credit_db_password.secret',
    RABBITMQ_URL: `amqp://${encodeURIComponent(username)}:${encodeURIComponent(password)}@127.0.0.1:${process.env.RABBITMQ_RECOVERY_HOST_PORT ?? '5676'}`,
    RABBITMQ_MANAGEMENT_URL: `http://127.0.0.1:${process.env.RABBITMQ_RECOVERY_MANAGEMENT_HOST_PORT ?? '15676'}`,
  };

  await run(
    process.execPath,
    [
      'node_modules/vitest/vitest.mjs',
      'run',
      '--config',
      './vitest.config.recovery.ts',
    ],
    { env: recoveryEnvironment },
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exitCode = 1;
} finally {
  await cleanup();
}

process.exitCode = interrupted ? 130 : exitCode;
