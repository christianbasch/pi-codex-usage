import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'UNIT',
    globals: true,
    environment: 'node',
    clearMocks: true,
    include: ['**/*.test.ts'],
  },
});
