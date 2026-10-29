import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { TodoList } from './TodoList'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('./TodoEmptyState', () => ({
  TodoEmptyState: () => <p>Empty task list</p>,
}))

const writeReport = { ...todoFixture, id: 2, title: 'Write the report' }
const bookTravel = { ...todoFixture, id: 1, title: 'Book travel' }

function renderList(overrides: Partial<ComponentProps<typeof TodoList>> = {}) {
  const callbacks = {
    onCreate: vi.fn(),
    onToggle: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  }
  render(
    <TodoList
      todos={[]}
      hasTodos={false}
      loading={false}
      failed={false}
      busy={false}
      {...callbacks}
      {...overrides}
    />,
  )
  return callbacks
}

it('shows loading feedback before showing an empty list', () => {
  const props = {
    todos: [],
    hasTodos: false,
    failed: false,
    busy: false,
    onCreate: vi.fn(),
    onToggle: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  }
  const { rerender } = render(<TodoList {...props} loading />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading your tasks…')
  expect(screen.queryByText('Empty task list')).not.toBeInTheDocument()
  rerender(<TodoList {...props} loading={false} />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByText('Empty task list')).toBeVisible()
})

it('characterization: shows the unavailable card when the query failed and there are no tasks', () => {
  renderList({ failed: true })
  expect(
    screen.getByRole('heading', {
      name: 'The task list is temporarily unavailable',
    }),
  ).toBeVisible()
  expect(
    screen.getByText('Try again to load your tasks.'),
  ).toBeVisible()
})

it('characterization: keeps loaded tasks visible and hides the unavailable card when the query failed', () => {
  renderList({ failed: true, hasTodos: true, todos: [todoFixture] })
  expect(
    screen.getByRole('heading', { name: todoFixture.title }),
  ).toBeVisible()
  expect(
    screen.queryByRole('heading', {
      name: 'The task list is temporarily unavailable',
    }),
  ).not.toBeInTheDocument()
})

it('characterization: renders one item per task in the order given', () => {
  renderList({ hasTodos: true, todos: [writeReport, bookTravel] })
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  expect(
    screen
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent),
  ).toEqual(['Write the report', 'Book travel'])
})

it('characterization: passes the matching task to the toggle, edit and delete callbacks', async () => {
  const user = userEvent.setup()
  const callbacks = renderList({
    hasTodos: true,
    todos: [writeReport, bookTravel],
  })
  await user.click(screen.getByRole('checkbox', { name: 'Complete: Book travel' }))
  expect(callbacks.onToggle).toHaveBeenCalledTimes(1)
  expect(callbacks.onToggle).toHaveBeenCalledWith(bookTravel)
  await user.click(
    screen.getByRole('button', { name: 'Edit: Write the report' }),
  )
  expect(callbacks.onEdit).toHaveBeenCalledTimes(1)
  expect(callbacks.onEdit).toHaveBeenCalledWith(writeReport)
  await user.click(
    screen.getByRole('button', { name: 'Delete: Book travel' }),
  )
  expect(callbacks.onDelete).toHaveBeenCalledTimes(1)
  expect(callbacks.onDelete).toHaveBeenCalledWith(bookTravel)
})
