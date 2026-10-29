import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { useCreateTodoMutation } from '../hooks/useCreateTodoMutation'
import { useUpdateTodoMutation } from '../hooks/useUpdateTodoMutation'
import type { TodoInput } from '../types'
import { TodoEditor } from './TodoEditor'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('../hooks/useCreateTodoMutation', () => ({
  useCreateTodoMutation: vi.fn(),
}))
vi.mock('../hooks/useUpdateTodoMutation', () => ({
  useUpdateTodoMutation: vi.fn(),
}))
vi.mock('./TodoForm', () => ({
  TodoForm: ({
    onSubmit,
    error,
  }: {
    onSubmit: (input: TodoInput) => Promise<void>
    error?: string | null
  }) => (
    <>
      <button onClick={() => void onSubmit(todoFixture)}>Submit form</button>
      {error && <p>{error}</p>}
    </>
  ),
}))

afterEach(() => {
  vi.unstubAllGlobals()
})

function testQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

it('creates a new task and reports a successful save', async () => {
  const user = userEvent.setup()
  const create = vi.fn().mockResolvedValue(todoFixture)
  const update = vi.fn()
  vi.mocked(useCreateTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync: create,
  } as unknown as ReturnType<typeof useCreateTodoMutation>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync: update,
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  const onSaved = vi.fn()
  render(
    <TodoEditor todo="new" busy={false} onClose={vi.fn()} onSaved={onSaved} />,
  )
  expect(screen.getByRole('dialog', { name: 'New task' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith('New task added.'))
  expect(create).toHaveBeenCalledWith(todoFixture)
  expect(update).not.toHaveBeenCalled()
})

it('sends a PATCH for the edited task and reports the save', async () => {
  const user = userEvent.setup()
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(todoFixture))
  vi.stubGlobal('fetch', fetchMock)
  const actual = await vi.importActual<
    typeof import('../hooks/useUpdateTodoMutation')
  >('../hooks/useUpdateTodoMutation')
  vi.mocked(useCreateTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof useCreateTodoMutation>)
  vi.mocked(useUpdateTodoMutation).mockImplementation(
    actual.useUpdateTodoMutation,
  )
  const onSaved = vi.fn()
  render(
    <QueryClientProvider client={testQueryClient()}>
      <TodoEditor
        todo={todoFixture}
        busy={false}
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    </QueryClientProvider>,
  )
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Changes saved.'))
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  expect(url).toBe('/api/todos/7')
  expect(init.method).toBe('PATCH')
  expect(JSON.parse(init.body as string)).toEqual({
    title: todoFixture.title,
    description: todoFixture.description,
    priority: todoFixture.priority,
    due_date: todoFixture.due_date,
    completed: todoFixture.completed,
  })
})

it('characterization: keeps the editor open with the server error when the save fails', async () => {
  const user = userEvent.setup()
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ detail: 'The server could not save the task.' }, 500),
      ),
  )
  const actual = await vi.importActual<
    typeof import('../hooks/useUpdateTodoMutation')
  >('../hooks/useUpdateTodoMutation')
  vi.mocked(useCreateTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof useCreateTodoMutation>)
  vi.mocked(useUpdateTodoMutation).mockImplementation(
    actual.useUpdateTodoMutation,
  )
  const onSaved = vi.fn()
  render(
    <QueryClientProvider client={testQueryClient()}>
      <TodoEditor
        todo={todoFixture}
        busy={false}
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    </QueryClientProvider>,
  )
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  expect(
    await screen.findByText('The server could not save the task.'),
  ).toBeVisible()
  expect(onSaved).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog', { name: 'Edit task' })).toBeVisible()
})

it('characterization: titles the drawer Edit task and reports Changes saved. after an edit', async () => {
  const user = userEvent.setup()
  const update = vi.fn().mockResolvedValue(todoFixture)
  vi.mocked(useCreateTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof useCreateTodoMutation>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync: update,
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  const onSaved = vi.fn()
  render(
    <TodoEditor
      todo={todoFixture}
      busy={false}
      onClose={vi.fn()}
      onSaved={onSaved}
    />,
  )
  expect(screen.getByRole('dialog', { name: 'Edit task' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Changes saved.'))
  expect(update).toHaveBeenCalledWith({ id: todoFixture.id, input: todoFixture })
})

it('characterization: shows the create error for a new task', () => {
  vi.mocked(useCreateTodoMutation).mockReturnValue({
    isPending: false,
    error: new Error('Could not create.'),
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof useCreateTodoMutation>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  render(
    <TodoEditor todo="new" busy={false} onClose={vi.fn()} onSaved={vi.fn()} />,
  )
  expect(screen.getByText('Could not create.')).toBeVisible()
})

it('characterization: sends nothing when a save is submitted while busy', async () => {
  const user = userEvent.setup()
  const create = vi.fn()
  const update = vi.fn()
  vi.mocked(useCreateTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync: create,
  } as unknown as ReturnType<typeof useCreateTodoMutation>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    isPending: false,
    error: null,
    mutateAsync: update,
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  const onSaved = vi.fn()
  render(
    <TodoEditor todo="new" busy onClose={vi.fn()} onSaved={onSaved} />,
  )
  await user.click(screen.getByRole('button', { name: 'Submit form' }))
  expect(create).not.toHaveBeenCalled()
  expect(update).not.toHaveBeenCalled()
  expect(onSaved).not.toHaveBeenCalled()
})
