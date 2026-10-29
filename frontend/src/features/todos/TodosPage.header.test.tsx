import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { useNotice } from '../../hooks/useNotice'
import { useTodoFilters } from './hooks/useTodoFilters'
import { useTodosBusy } from './hooks/useTodosBusy'
import { useTodosQuery } from './hooks/useTodosQuery'
import { useUpdateTodoMutation } from './hooks/useUpdateTodoMutation'
import { TodosPage } from './TodosPage'

vi.mock('../../design-system', () => import('../../design-system/mocks'))
vi.mock('../../hooks/useNotice', () => ({ useNotice: vi.fn() }))
vi.mock('./hooks/useTodoFilters', () => ({ useTodoFilters: vi.fn() }))
vi.mock('./hooks/useTodosBusy', () => ({ useTodosBusy: vi.fn() }))
vi.mock('./hooks/useTodosQuery', () => ({ useTodosQuery: vi.fn() }))
vi.mock('./hooks/useUpdateTodoMutation', () => ({
  useUpdateTodoMutation: vi.fn(),
}))
vi.mock('./components/TodoStats', () => ({ TodoStats: () => null }))
vi.mock('./components/TodoFilters', () => ({ TodoFilters: () => null }))

interface HeaderState {
  isPending?: boolean
  busy?: boolean
}

// Only the query, filter and busy hooks are faked; the header, list, editor and
// mutations are real.
async function mockHeader({ isPending = false, busy = false }: HeaderState = {}) {
  const updateActual = await vi.importActual<
    typeof import('./hooks/useUpdateTodoMutation')
  >('./hooks/useUpdateTodoMutation')
  const noticeActual = await vi.importActual<typeof import('../../hooks/useNotice')>(
    '../../hooks/useNotice',
  )
  vi.mocked(useTodosQuery).mockReturnValue({
    data: [],
    isPending,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useTodosQuery>)
  vi.mocked(useTodoFilters).mockReturnValue({
    filter: 'all',
    search: '',
    sort: 'newest',
    visible: [],
    setFilter: vi.fn(),
    setSearch: vi.fn(),
    setSort: vi.fn(),
  })
  vi.mocked(useTodosBusy).mockReturnValue(busy)
  vi.mocked(useUpdateTodoMutation).mockImplementation(
    updateActual.useUpdateTodoMutation,
  )
  vi.mocked(useNotice).mockImplementation(noticeActual.useNotice)
}

async function renderHeader(state: HeaderState = {}) {
  await mockHeader(state)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const page = () => (
    <QueryClientProvider client={client}>
      <TodosPage />
    </QueryClientProvider>
  )
  const view = render(page())
  return {
    rerender: async (next: HeaderState = {}) => {
      await mockHeader(next)
      view.rerender(page())
    },
  }
}

it('characterization: disables New task while the list loads or a save is pending', async () => {
  const view = await renderHeader({ isPending: true })
  expect(screen.getByRole('button', { name: 'New task' })).toBeDisabled()
  await view.rerender({ busy: true })
  expect(screen.getByRole('button', { name: 'New task' })).toBeDisabled()
  await view.rerender({})
  expect(screen.getByRole('button', { name: 'New task' })).toBeEnabled()
})

it('characterization: opens the New task editor from the header', async () => {
  const user = userEvent.setup()
  await renderHeader({})
  await user.click(screen.getByRole('button', { name: 'New task' }))
  expect(screen.getByRole('dialog', { name: 'New task' })).toBeVisible()
})
