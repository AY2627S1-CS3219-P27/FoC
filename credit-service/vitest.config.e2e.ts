import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      PORT: '3000',
      LOG_LEVEL: 'error',
      DB_HOST: '127.0.0.1',
      DB_PORT: '5436',
      DB_USERNAME: 'credit_service',
      DB_DATABASE: 'credit_service_test',
      DB_PASSWORD_FILE: './secrets/credit_db_password.secret',
      RABBITMQ_USER: 'credit-service',
      RABBITMQ_HOST: 'rabbitmq',
      RABBITMQ_PORT: '5672',
      RABBITMQ_VHOST: '/foc',
      RABBITMQ_PASSWORD_FILE: './secrets/credit_db_password.secret',
    },
  },
});
