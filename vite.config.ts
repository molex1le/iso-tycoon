import { defineConfig } from 'vitest/config';

// BALANCE=1 – вместо тестов прогоняются симуляции баланса из scripts/
const balance = process.env.BALANCE === '1';

export default defineConfig({
  base: './',
  test: {
    environment: 'node',
    include: balance ? ['scripts/**/*.sim.ts'] : ['tests/**/*.test.ts'],
  },
});
