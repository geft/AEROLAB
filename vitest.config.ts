import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    env: {
      DATABASE_PATH: ':memory:'
    },
    include: ['tests/**/*.{test,spec}.{ts,tsx}']
  }
});

