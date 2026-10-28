import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { todosApi } from '../api/todos'
import { useTodoStatsQuery } from './useTodoStatsQuery'

vi.mock('../api/todos', () => ({ todosApi: { stats: vi.fn() } }))
beforeEach(() => vi.clearAllMocks())

const stats = {
  total: 1,
  open: 1,
  completed: 0,
  by_priority: { low: 0, medium: 1, high: 0 },
  overdue: 0,
}

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

it('loads stats from the API', async () => {
  vi.mocked(todosApi.stats).mockResolvedValue(stats)
  const { result } = renderHook(() => useTodoStatsQuery(), {
    wrapper: wrapper(),
  })
  await waitFor(() => expect(result.current.data).toEqual(stats))
})

it('has no data when the request fails', async () => {
  vi.mocked(todosApi.stats).mockRejectedValue(new Error('boom'))
  const { result } = renderHook(() => useTodoStatsQuery(), {
    wrapper: wrapper(),
  })
  await waitFor(() => expect(result.current.isError).toBe(true))
  expect(result.current.data).toBeUndefined()
})
