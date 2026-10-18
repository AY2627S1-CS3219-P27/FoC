import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

// Supplier validation through a real broker and database (as credit-service):
//   npm run db:test:up && npm run broker:test:up && npm run test:messaging
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.messaging-spec.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      DB_HOST: '127.0.0.1',
      DB_PORT: process.env.SUPPLIER_DB_TEST_HOST_PORT ?? '5439',
      DB_USERNAME: 'supplier_service',
      DB_DATABASE: 'supplier_service_test',
      DB_PASSWORD_FILE: './secrets/supplier_db_password.secret',
      RABBITMQ_TEST_URL: `amqp://supplier_service_test:supplier_service_test@127.0.0.1:${process.env.SUPPLIER_RABBITMQ_TEST_HOST_PORT ?? '5677'}`,
    },
  },
});
