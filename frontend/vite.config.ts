import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Source the owner chose not to test, from .github/scripts/contracts/ignored-paths.json; the PR workflow skips the
// same files. Read only under vitest, because the Docker build copies just this folder.
function ignoredPaths(): string[] {
  if (!process.env.VITEST) return []
  const file = new URL('../.github/scripts/contracts/ignored-paths.json', import.meta.url)
  const { ignored } = JSON.parse(readFileSync(file, 'utf8')) as { ignored: { package: string; paths: string[] }[] }
  return ignored.filter((entry) => entry.package === 'frontend').flatMap((entry) => entry.paths)
}

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:8000' } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/main.tsx',
        'src/test/**',
        'src/**/*.test.{ts,tsx}',
        'src/**/types.ts',
        'src/**/*.types.ts',
        'src/**/index.ts',
        'src/**/constants.{ts,tsx}',
        'src/**/*.constants.ts',
        'src/features/todos/api/queryKeys.ts',
        'src/lib/queryClient.ts',
        ...ignoredPaths(),
      ],
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      // Backfill floors: the level each file reached, rounded down, so coverage cannot silently regress.
      thresholds: {
        perFile: true,
        'src/{lib/http,hooks/useNotice,features/todos/api/todos}.ts': {
          statements: 100, branches: 100, functions: 100, lines: 100,
        },
        'src/features/todos/hooks/{useCreateTodoMutation,useUpdateTodoMutation,useTodoFilters,useTodosBusy,useTodosQuery}.ts': {
          statements: 100, branches: 100, functions: 100, lines: 100,
        },
        'src/features/todos/components/{TodoEditor,TodoEmptyState,TodoForm,TodoItem,TodoList}.tsx': {
          statements: 100, branches: 100, functions: 100, lines: 100,
        },
        'src/features/todos/utils/todos.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/features/todos/components/DeleteTodoDialog.tsx': { statements: 88, branches: 87, functions: 100, lines: 100 },
        'src/features/todos/TodosPage.tsx': { statements: 96, branches: 88, functions: 100, lines: 100 },
      },
    },
  },
})
