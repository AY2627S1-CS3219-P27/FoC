import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

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
      DB_HOST: 'localhost',
      DB_PORT: '5436',
      DB_USERNAME: 'order_service',
      DB_DATABASE: 'order_service',
      DB_PASSWORD_FILE: '/dev/null',
      DB_SYNCHRONIZE: 'false',
    },
  },
});
