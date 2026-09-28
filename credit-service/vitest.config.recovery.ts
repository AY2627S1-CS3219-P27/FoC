import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.recovery-spec.ts'],
    fileParallelism: false,
    pool: 'threads',
    maxWorkers: 1,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: 'test',
      PORT: '3000',
      LOG_LEVEL: 'error',
    },
  },
});
