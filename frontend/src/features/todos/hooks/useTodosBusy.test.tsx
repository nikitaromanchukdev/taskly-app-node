import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { todosApi } from '../api/todos'
import type { Todo } from '../types'
import { useCreateTodoMutation } from './useCreateTodoMutation'
import { useTodosBusy } from './useTodosBusy'

vi.mock('../api/todos', () => ({ todosApi: { create: vi.fn() } }))
beforeEach(() => vi.clearAllMocks())

it('characterization: is busy while a todo mutation is pending and idle once it settles', async () => {
  let settle!: (saved: Todo) => void
  vi.mocked(todosApi.create).mockReturnValue(
    new Promise<Todo>((resolve) => {
      settle = resolve
    }),
  )
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const busy = renderHook(() => useTodosBusy(), { wrapper })
  const mutation = renderHook(() => useCreateTodoMutation(), { wrapper })
  expect(busy.result.current).toBe(false)
  act(() => {
    mutation.result.current.mutate(todoFixture)
  })
  await waitFor(() => expect(busy.result.current).toBe(true))
  await act(async () => {
    settle(todoFixture)
  })
  await waitFor(() => expect(busy.result.current).toBe(false))
})
