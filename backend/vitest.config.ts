import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Source the owner chose not to test, from .github/scripts/contracts/ignored-paths.json; the PR workflow skips the
// same files.
function ignoredPaths(): string[] {
  const file = new URL('../.github/scripts/contracts/ignored-paths.json', import.meta.url);
  const { ignored } = JSON.parse(readFileSync(file, 'utf8')) as { ignored: { package: string; paths: string[] }[] };
  return ignored.filter((entry) => entry.package === 'backend').flatMap((entry) => entry.paths);
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/types.ts', 'src/generated/**', ...ignoredPaths()],
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
