import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/types.ts', 'src/generated/**'],
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: {
        perFile: true,
        'src/features/todos/{validators,mappers}.ts': {
          statements: 100, branches: 100, functions: 100, lines: 100,
        },
        // Backfill floors: the level each file reached, rounded down, so coverage cannot silently regress.
        'src/{api/health,core/config,core/database,features/todos/router}.ts': {
          statements: 100, branches: 100, functions: 100, lines: 100,
        },
        'src/factory.ts': { statements: 95, branches: 92, functions: 100, lines: 100 },
        'src/core/lifespan.ts': { statements: 24, branches: 0, functions: 16, lines: 30 },
      },
    },
  },
});
