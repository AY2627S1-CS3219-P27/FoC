import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.messaging-spec.ts'],
    fileParallelism: false,
    testTimeout: 10_000,
    hookTimeout: 10_000,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
    },
  },
});
