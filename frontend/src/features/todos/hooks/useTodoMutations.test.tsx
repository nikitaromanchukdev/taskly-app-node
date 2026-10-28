import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { useCreateTodoMutation } from './useCreateTodoMutation'
import { useDeleteTodoMutation } from './useDeleteTodoMutation'
import { useUpdateTodoMutation } from './useUpdateTodoMutation'

vi.mock('../api/todos', () => ({
  todosApi: { create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}))
beforeEach(() => vi.clearAllMocks())

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { invalidate, wrapper }
}

it('refreshes stats after a task is created', async () => {
  vi.mocked(todosApi.create).mockResolvedValue(todoFixture)
  const { invalidate, wrapper } = setup()
  const { result } = renderHook(() => useCreateTodoMutation(), { wrapper })
  await act(() => result.current.mutateAsync(todoFixture))
  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({ queryKey: todoKeys.stats }),
  )
})

it('refreshes stats after a task is updated', async () => {
  vi.mocked(todosApi.update).mockResolvedValue(todoFixture)
  const { invalidate, wrapper } = setup()
  const { result } = renderHook(() => useUpdateTodoMutation(), { wrapper })
  await act(() =>
    result.current.mutateAsync({ id: 7, input: { completed: true } }),
  )
  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({ queryKey: todoKeys.stats }),
  )
})

it('refreshes stats after a task is deleted', async () => {
  vi.mocked(todosApi.remove).mockResolvedValue(undefined)
  const { invalidate, wrapper } = setup()
  const { result } = renderHook(() => useDeleteTodoMutation(), { wrapper })
  await act(() => result.current.mutateAsync(7))
  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({ queryKey: todoKeys.stats }),
  )
})
