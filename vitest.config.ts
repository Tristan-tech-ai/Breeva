import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts so unit tests do not load the PWA and build plugins.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
