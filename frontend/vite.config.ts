import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

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
        'src/design-system/**',
        'src/**/types.ts',
        'src/**/*.types.ts',
        'src/**/index.ts',
        'src/**/constants.{ts,tsx}',
        'src/**/*.constants.ts',
        'src/features/todos/api/queryKeys.ts',
        'src/lib/queryClient.ts',
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
