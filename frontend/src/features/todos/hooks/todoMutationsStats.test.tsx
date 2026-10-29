import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import type { Todo } from '../types'
import { useCreateTodoMutation } from './useCreateTodoMutation'
import { useDeleteTodoMutation } from './useDeleteTodoMutation'
import { useTodosQuery } from './useTodosQuery'
import { useUpdateTodoMutation } from './useUpdateTodoMutation'

vi.mock('../api/todos', () => ({
  todosApi: {
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    list: vi.fn(),
  },
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
  return { wrapper, invalidate }
}

// A list cached in the same client. staleTime is infinite so useTodosQuery
// reads the cache and never calls the API.
function cachedClient(list?: Todo[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  if (list) client.setQueryData(todoKeys.list, list)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

it('refreshes stats after a task is created', async () => {
  vi.mocked(todosApi.create).mockResolvedValue(todoFixture)
  const { wrapper, invalidate } = setup()
  const { result } = renderHook(() => useCreateTodoMutation(), { wrapper })
  result.current.mutate(todoFixture)
  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({ queryKey: todoKeys.stats }),
  )
})

it('refreshes stats after a task is updated', async () => {
  vi.mocked(todosApi.update).mockResolvedValue(todoFixture)
  const { wrapper, invalidate } = setup()
  const { result } = renderHook(() => useUpdateTodoMutation(), { wrapper })
  result.current.mutate({ id: todoFixture.id, input: { completed: true } })
  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({ queryKey: todoKeys.stats }),
  )
})

it('refreshes stats after a task is deleted', async () => {
  vi.mocked(todosApi.remove).mockResolvedValue(undefined)
  const { wrapper, invalidate } = setup()
  const { result } = renderHook(() => useDeleteTodoMutation(), { wrapper })
  result.current.mutate(todoFixture.id)
  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({ queryKey: todoKeys.stats }),
  )
})

it('puts the saved task first and drops the cached copy with the same id', async () => {
  const other = { ...todoFixture, id: 8, title: 'Buy milk' }
  const staleCopy = { ...todoFixture, title: 'Old title' }
  vi.mocked(todosApi.create).mockResolvedValue(todoFixture)
  const { wrapper } = cachedClient([staleCopy, other])
  const mutation = renderHook(() => useCreateTodoMutation(), { wrapper })
  const list = renderHook(() => useTodosQuery(), { wrapper })
  mutation.result.current.mutate(todoFixture)
  await waitFor(() =>
    expect(list.result.current.data).toEqual([todoFixture, other]),
  )
})

it('replaces only the updated task in the cached list', async () => {
  const other = { ...todoFixture, id: 8, title: 'Buy milk' }
  const saved = { ...todoFixture, completed: true }
  vi.mocked(todosApi.update).mockResolvedValue(saved)
  const { wrapper } = cachedClient([todoFixture, other])
  const mutation = renderHook(() => useUpdateTodoMutation(), { wrapper })
  const list = renderHook(() => useTodosQuery(), { wrapper })
  mutation.result.current.mutate({
    id: todoFixture.id,
    input: { completed: true },
  })
  await waitFor(() => expect(list.result.current.data).toEqual([saved, other]))
})

it('leaves the list uncached when no list was cached', async () => {
  vi.mocked(todosApi.update).mockResolvedValue(todoFixture)
  const { client, wrapper } = cachedClient()
  const mutation = renderHook(() => useUpdateTodoMutation(), { wrapper })
  mutation.result.current.mutate({
    id: todoFixture.id,
    input: { completed: true },
  })
  await waitFor(() => expect(mutation.result.current.isSuccess).toBe(true))
  expect(client.getQueryData(todoKeys.list)).toBeUndefined()
})

it('starts the list with only the saved task when no list was cached', async () => {
  vi.mocked(todosApi.create).mockResolvedValue(todoFixture)
  const { client, wrapper } = cachedClient()
  const mutation = renderHook(() => useCreateTodoMutation(), { wrapper })
  mutation.result.current.mutate(todoFixture)
  await waitFor(() => expect(mutation.result.current.isSuccess).toBe(true))
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
})
