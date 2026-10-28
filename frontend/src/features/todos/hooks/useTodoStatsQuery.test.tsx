import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { todosApi } from '../api/todos'
import type { TodoStats } from '../types'
import { useTodoStatsQuery } from './useTodoStatsQuery'

vi.mock('../api/todos', () => ({ todosApi: { stats: vi.fn() } }))
beforeEach(() => vi.clearAllMocks())

const stats: TodoStats = {
  total: 3,
  open: 2,
  completed: 1,
  by_priority: { low: 1, medium: 1, high: 1 },
  overdue: 1,
}

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

it('loads task stats from the API', async () => {
  vi.mocked(todosApi.stats).mockResolvedValue(stats)
  const { result } = renderHook(() => useTodoStatsQuery(), {
    wrapper: wrapper(),
  })
  await waitFor(() => expect(result.current.data).toEqual(stats))
  expect(todosApi.stats).toHaveBeenCalledTimes(1)
})
