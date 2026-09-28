import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

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
      DB_PORT: '5436',
      DB_USERNAME: 'credit_service',
      DB_DATABASE: 'credit_service_test',
      DB_PASSWORD_FILE: './secrets/credit_db_password.secret',
    },
  },
});
