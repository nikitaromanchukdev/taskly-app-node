import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import type { Todo } from '../types'
import { TodoItem } from './TodoItem'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

function renderItem(todo: Todo) {
  return render(
    <TodoItem
      todo={todo}
      busy={false}
      onEdit={vi.fn()}
      onToggle={vi.fn()}
      onDelete={vi.fn()}
    />,
  )
}

it('shows an active task and forwards edit requests', async () => {
  const user = userEvent.setup()
  const onEdit = vi.fn()
  const onToggle = vi.fn()
  const onDelete = vi.fn()
  render(
    <TodoItem
      todo={todoFixture}
      busy={false}
      onEdit={onEdit}
      onToggle={onToggle}
      onDelete={onDelete}
    />,
  )
  expect(screen.getByRole('heading', { name: todoFixture.title })).toBeVisible()
  expect(screen.getByText('To do')).toBeVisible()
  expect(screen.getByText('Medium')).toBeVisible()
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  await user.click(
    screen.getByRole('button', { name: `Edit: ${todoFixture.title}` }),
  )
  expect(onEdit).toHaveBeenCalledTimes(1)
  expect(onToggle).not.toHaveBeenCalled()
  expect(onDelete).not.toHaveBeenCalled()
})

it('characterization: shows the description when the task has one', () => {
  renderItem({ ...todoFixture, description: 'Slides for Friday' })
  expect(screen.getByText('Slides for Friday')).toBeVisible()
})

it('characterization: shows a Completed badge and a Mark as active checkbox for a completed task', () => {
  renderItem({ ...todoFixture, completed: true })
  expect(screen.getByText('Completed')).toBeVisible()
  expect(
    screen.getByRole('checkbox', { name: 'Mark as active: Prepare a demo' }),
  ).toBeChecked()
})

describe('dated tasks', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 15, 12))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('characterization: shows the overdue suffix on an open task due before today', () => {
    renderItem({ ...todoFixture, due_date: '2026-10-14' })
    expect(screen.getByText('14 Oct 2026 · overdue')).toBeVisible()
  })

  it.each([
    ['2026-10-15', '15 Oct 2026'],
    ['2026-10-16', '16 Oct 2026'],
  ])(
    'characterization: shows no overdue suffix when the task is due on or after today (%s)',
    (dueDate, label) => {
      renderItem({ ...todoFixture, due_date: dueDate })
      expect(screen.getByText(label)).toBeVisible()
      expect(screen.queryByText(/overdue/)).not.toBeInTheDocument()
    },
  )

  it('characterization: shows no overdue suffix on a completed task past its due date', () => {
    renderItem({ ...todoFixture, completed: true, due_date: '2026-10-14' })
    expect(screen.getByText('14 Oct 2026')).toBeVisible()
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument()
  })

  it('characterization: formats the due date as day, short month and year', () => {
    renderItem({ ...todoFixture, due_date: '2026-10-20' })
    expect(screen.getByText('20 Oct 2026')).toBeVisible()
  })
})
