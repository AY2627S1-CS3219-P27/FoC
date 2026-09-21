import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    env: {
      NODE_ENV: 'test',
      PORT: '3000',
      LOG_LEVEL: 'error',
      DB_HOST: 'credit-db',
      DB_PORT: '5432',
      DB_USERNAME: 'credit_service',
      DB_DATABASE: 'credit_service',
      DB_PASSWORD_FILE: '/run/secrets/credit_db_password',
    },
  },
});
