import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { useDeleteTodoMutation } from '../hooks/useDeleteTodoMutation'
import { DeleteTodoDialog } from './DeleteTodoDialog'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('../hooks/useDeleteTodoMutation', () => ({
  useDeleteTodoMutation: vi.fn(),
}))

afterEach(() => {
  vi.unstubAllGlobals()
})

function deleteState(
  overrides: {
    isPending?: boolean
    error?: Error | null
    mutateAsync?: ReturnType<typeof vi.fn>
  } = {},
) {
  return {
    isPending: false,
    error: null,
    mutateAsync: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useDeleteTodoMutation>
}

it('shows a deletion error and allows cancelling without deleting', async () => {
  const user = userEvent.setup()
  const mutateAsync = vi.fn()
  vi.mocked(useDeleteTodoMutation).mockReturnValue({
    isPending: false,
    error: new Error('Could not delete.'),
    mutateAsync,
  } as unknown as ReturnType<typeof useDeleteTodoMutation>)
  const onClose = vi.fn()
  const onDeleted = vi.fn()
  render(
    <DeleteTodoDialog
      todo={todoFixture}
      busy={false}
      onClose={onClose}
      onDeleted={onDeleted}
    />,
  )
  expect(screen.getByRole('dialog', { name: 'Delete task?' })).toBeVisible()
  expect(
    screen.getByText(
      `The task “${todoFixture.title}” will be permanently deleted.`,
    ),
  ).toBeVisible()
  expect(screen.getByTestId('alert')).toHaveTextContent('Could not delete.')
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onClose).toHaveBeenCalledTimes(1)
  expect(mutateAsync).not.toHaveBeenCalled()
  expect(onDeleted).not.toHaveBeenCalled()
})

it('sends a DELETE for the task once the deletion is confirmed', async () => {
  const user = userEvent.setup()
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetchMock)
  const actual = await vi.importActual<
    typeof import('../hooks/useDeleteTodoMutation')
  >('../hooks/useDeleteTodoMutation')
  vi.mocked(useDeleteTodoMutation).mockImplementation(
    actual.useDeleteTodoMutation,
  )
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <DeleteTodoDialog
        todo={todoFixture}
        busy={false}
        onClose={vi.fn()}
        onDeleted={vi.fn()}
      />
    </QueryClientProvider>,
  )
  await user.click(screen.getByRole('button', { name: 'Delete task' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  expect(url).toBe('/api/todos/7')
  expect(init.method).toBe('DELETE')
})

it('characterization: calls onDeleted once when the deletion succeeds', async () => {
  const user = userEvent.setup()
  const mutateAsync = vi.fn().mockResolvedValue(undefined)
  vi.mocked(useDeleteTodoMutation).mockReturnValue(
    deleteState({ mutateAsync }),
  )
  const onDeleted = vi.fn()
  render(
    <DeleteTodoDialog
      todo={todoFixture}
      busy={false}
      onClose={vi.fn()}
      onDeleted={onDeleted}
    />,
  )
  await user.click(screen.getByRole('button', { name: 'Delete task' }))
  await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))
  expect(mutateAsync).toHaveBeenCalledWith(todoFixture.id)
})

it('characterization: keeps the dialog open and does not call onDeleted when the deletion fails', async () => {
  const user = userEvent.setup()
  const error = new Error('Could not delete.')
  const mutateAsync = vi.fn().mockRejectedValue(error)
  vi.mocked(useDeleteTodoMutation).mockReturnValue(
    deleteState({ mutateAsync, error }),
  )
  const onDeleted = vi.fn()
  const onClose = vi.fn()
  render(
    <DeleteTodoDialog
      todo={todoFixture}
      busy={false}
      onClose={onClose}
      onDeleted={onDeleted}
    />,
  )
  await user.click(screen.getByRole('button', { name: 'Delete task' }))
  expect(mutateAsync).toHaveBeenCalledTimes(1)
  // The dialog is always open while mounted; only the parent closes it, through these callbacks.
  expect(onDeleted).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
})

it('characterization: reads Deleting… and is disabled while a deletion is pending, and sends nothing on a second confirm', async () => {
  const user = userEvent.setup()
  const mutateAsync = vi.fn()
  vi.mocked(useDeleteTodoMutation).mockReturnValue(
    deleteState({ isPending: true, mutateAsync }),
  )
  render(
    <DeleteTodoDialog
      todo={todoFixture}
      busy={false}
      onClose={vi.fn()}
      onDeleted={vi.fn()}
    />,
  )
  const confirm = screen.getByRole('button', { name: 'Deleting…' })
  expect(confirm).toBeDisabled()
  await user.click(confirm)
  expect(mutateAsync).not.toHaveBeenCalled()
})
