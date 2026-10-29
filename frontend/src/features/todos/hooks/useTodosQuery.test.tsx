import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { useTodosQuery } from './useTodosQuery'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { wrapper }
}

it('requests GET /api/todos and exposes the tasks as data', async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify([todoFixture]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  const { wrapper } = setup()
  const { result } = renderHook(() => useTodosQuery(), { wrapper })
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(result.current.data).toEqual([todoFixture])
  expect(fetchMock.mock.calls[0][0]).toBe('/api/todos')
})

it('characterization: reports the request failure as the query error', async () => {
  fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
  const { wrapper } = setup()
  const { result } = renderHook(() => useTodosQuery(), { wrapper })
  await waitFor(() => expect(result.current.isError).toBe(true))
  expect(result.current.error?.message).toBe(
    'Cannot connect to the server. Please try again.',
  )
})
