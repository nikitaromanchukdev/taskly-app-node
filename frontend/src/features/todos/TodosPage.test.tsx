import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { useNotice } from '../../hooks/useNotice'
import { todoFixture } from '../../test/todoFixture'
import { useTodoFilters } from './hooks/useTodoFilters'
import { useTodosBusy } from './hooks/useTodosBusy'
import { useTodosQuery } from './hooks/useTodosQuery'
import { useUpdateTodoMutation } from './hooks/useUpdateTodoMutation'
import { TodosPage } from './TodosPage'
import type { Todo } from './types'

vi.mock('../../design-system', () => import('../../design-system/mocks'))
vi.mock('../../hooks/useNotice', () => ({ useNotice: vi.fn() }))
vi.mock('./hooks/useTodoFilters', () => ({ useTodoFilters: vi.fn() }))
vi.mock('./hooks/useTodosBusy', () => ({ useTodosBusy: vi.fn() }))
vi.mock('./hooks/useTodosQuery', () => ({ useTodosQuery: vi.fn() }))
vi.mock('./hooks/useUpdateTodoMutation', () => ({
  useUpdateTodoMutation: vi.fn(),
}))
vi.mock('./components/TodosHeader', () => ({
  TodosHeader: () => <h1>Tasks</h1>,
}))
vi.mock('./components/TodoFilters', () => ({ TodoFilters: () => null }))

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

interface PageOptions {
  busy?: boolean
  visible?: Todo[]
  isFetching?: boolean
  queryError?: Error | null
}

function testClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

// Sets the hook mocks for one page state. Only the query, filter and busy
// hooks are faked; the list, item, editor, dialog and mutations are real.
async function mockPage(
  todos: Todo[],
  {
    busy = false,
    visible = todos,
    isFetching = false,
    queryError = null,
  }: PageOptions = {},
) {
  const updateActual = await vi.importActual<
    typeof import('./hooks/useUpdateTodoMutation')
  >('./hooks/useUpdateTodoMutation')
  const noticeActual = await vi.importActual<typeof import('../../hooks/useNotice')>(
    '../../hooks/useNotice',
  )
  vi.mocked(useTodosQuery).mockReturnValue({
    data: todos,
    isPending: false,
    isFetching,
    isError: queryError !== null,
    error: queryError,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useTodosQuery>)
  vi.mocked(useTodoFilters).mockReturnValue({
    filter: 'all',
    search: '',
    sort: 'newest',
    visible,
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

function page(client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <TodosPage />
    </QueryClientProvider>
  )
}

async function renderPage(todos: Todo[], options: PageOptions = {}) {
  await mockPage(todos, options)
  const client = testClient()
  const view = render(page(client))
  return {
    rerender: async (nextTodos: Todo[], nextOptions: PageOptions = {}) => {
      await mockPage(nextTodos, nextOptions)
      view.rerender(page(client))
    },
  }
}

it('displays a query failure and resets mutation errors before retrying', async () => {
  const user = userEvent.setup()
  const refetch = vi.fn().mockResolvedValue(undefined)
  const reset = vi.fn()
  vi.mocked(useTodosQuery).mockReturnValue({
    data: [],
    isPending: false,
    isFetching: false,
    isError: true,
    error: new Error('The server is unavailable.'),
    refetch,
  } as unknown as ReturnType<typeof useTodosQuery>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    error: null,
    reset,
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  vi.mocked(useTodosBusy).mockReturnValue(false)
  vi.mocked(useNotice).mockReturnValue({ message: '', notify: vi.fn() })
  vi.mocked(useTodoFilters).mockReturnValue({
    filter: 'all',
    search: '',
    sort: 'newest',
    visible: [],
    setFilter: vi.fn(),
    setSearch: vi.fn(),
    setSort: vi.fn(),
  })
  render(<TodosPage />)
  expect(screen.getByTestId('alert')).toHaveTextContent(
    'The server is unavailable.',
  )
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1))
  expect(reset).toHaveBeenCalledTimes(1)
  expect(reset.mock.invocationCallOrder[0]).toBeLessThan(
    refetch.mock.invocationCallOrder[0],
  )
})

it('sends a PATCH with the opposite completed value when a task is toggled', async () => {
  const user = userEvent.setup()
  const fetchMock = stubFetch(jsonResponse({ ...todoFixture, completed: true }))
  await renderPage([todoFixture])
  await user.click(
    screen.getByRole('checkbox', { name: 'Complete: Prepare a demo' }),
  )
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  expect(url).toBe('/api/todos/7')
  expect(init.method).toBe('PATCH')
  expect(JSON.parse(init.body as string)).toEqual({ completed: true })
})

it('characterization: shows the mutation message and a Try again button when a toggle fails', async () => {
  const user = userEvent.setup()
  stubFetch(jsonResponse({ detail: 'The server could not save the task.' }, 500))
  await renderPage([todoFixture])
  await user.click(
    screen.getByRole('checkbox', { name: 'Complete: Prepare a demo' }),
  )
  expect(
    await screen.findByText('The server could not save the task.'),
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
})

it('characterization: sends no toggle while a save is pending', async () => {
  const user = userEvent.setup()
  const fetchMock = stubFetch(jsonResponse(todoFixture))
  await renderPage([todoFixture], { busy: true })
  const checkbox = screen.getByRole('checkbox', {
    name: 'Complete: Prepare a demo',
  })
  expect(checkbox).toBeDisabled()
  await user.click(checkbox)
  expect(fetchMock).not.toHaveBeenCalled()
})

it('characterization: shows the completion notice when a task is marked complete', async () => {
  const user = userEvent.setup()
  stubFetch(jsonResponse({ ...todoFixture, completed: true }))
  await renderPage([todoFixture])
  await user.click(
    screen.getByRole('checkbox', { name: 'Complete: Prepare a demo' }),
  )
  expect(
    await screen.findByText('Another task complete. Well done!'),
  ).toBeVisible()
})

it('characterization: shows the reopened notice when a completed task is marked active', async () => {
  const user = userEvent.setup()
  stubFetch(jsonResponse({ ...todoFixture, completed: false }))
  await renderPage([{ ...todoFixture, completed: true }])
  await user.click(
    screen.getByRole('checkbox', { name: 'Mark as active: Prepare a demo' }),
  )
  expect(await screen.findByText('Task marked as active.')).toBeVisible()
})

it('characterization: shows New task added. after the editor saves a new task', async () => {
  const user = userEvent.setup()
  const fetchMock = stubFetch(
    jsonResponse({ ...todoFixture, id: 8, title: 'Plan the week' }, 201),
  )
  await renderPage([])
  await user.click(
    screen.getByRole('button', { name: 'Add your first task' }),
  )
  expect(screen.getByRole('dialog', { name: 'New task' })).toBeVisible()
  await user.type(screen.getByLabelText(/Task title/), 'Plan the week')
  await user.click(screen.getByRole('button', { name: 'Save task' }))
  expect(await screen.findByText('New task added.')).toBeVisible()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/todos',
    expect.objectContaining({ method: 'POST' }),
  )
})

it('characterization: shows Task deleted. after the deletion is confirmed', async () => {
  const user = userEvent.setup()
  stubFetch(new Response(null, { status: 204 }))
  await renderPage([todoFixture])
  await user.click(
    screen.getByRole('button', { name: 'Delete: Prepare a demo' }),
  )
  expect(screen.getByRole('dialog', { name: 'Delete task?' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Delete task' }))
  expect(await screen.findByText('Task deleted.')).toBeVisible()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('characterization: shows No matching tasks when tasks exist but none are visible', async () => {
  await renderPage([todoFixture], { visible: [] })
  expect(
    screen.getByRole('heading', { name: 'No matching tasks' }),
  ).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Add your first task' }),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('heading', { name: 'Add your first task' }),
  ).not.toBeInTheDocument()
})

it('characterization: disables Try again while the list is refetching or a save is pending', async () => {
  const queryError = new Error('The server is unavailable.')
  const view = await renderPage([todoFixture], {
    queryError,
    isFetching: true,
  })
  expect(screen.getByRole('button', { name: 'Try again' })).toBeDisabled()
  await view.rerender([todoFixture], { queryError, busy: true })
  expect(screen.getByRole('button', { name: 'Try again' })).toBeDisabled()
})

it('characterization: closes the editor and the delete dialog on Cancel', async () => {
  const user = userEvent.setup()
  const view = await renderPage([])
  await user.click(
    screen.getByRole('button', { name: 'Add your first task' }),
  )
  expect(screen.getByRole('dialog', { name: 'New task' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await view.rerender([todoFixture])
  await user.click(
    screen.getByRole('button', { name: 'Delete: Prepare a demo' }),
  )
  expect(screen.getByRole('dialog', { name: 'Delete task?' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it("characterization: opens the editor filled with the task's values when Edit is used", async () => {
  const user = userEvent.setup()
  await renderPage([todoFixture])
  await user.click(screen.getByRole('button', { name: 'Edit: Prepare a demo' }))
  expect(screen.getByRole('dialog', { name: 'Edit task' })).toBeVisible()
  expect(screen.getByLabelText(/Task title/)).toHaveValue('Prepare a demo')
})
