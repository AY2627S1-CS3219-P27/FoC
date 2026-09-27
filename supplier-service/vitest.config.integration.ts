import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

// DB-backed tests against the throwaway compose database:
//   npm run db:test:up && npm run test:integration && npm run db:test:down
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.integration-spec.ts'],
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DB_HOST: '127.0.0.1',
      DB_PORT: process.env.SUPPLIER_DB_TEST_HOST_PORT ?? '5439',
      DB_USERNAME: 'supplier_service',
      DB_DATABASE: 'supplier_service_test',
      DB_PASSWORD_FILE: './secrets/supplier_db_password.secret',
    },
  },
});
