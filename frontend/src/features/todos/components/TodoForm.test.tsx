import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TodoForm } from './TodoForm'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

describe('TodoForm', () => {
  it('rejects a whitespace-only title without submitting', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(
      <TodoForm
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        busy={false}
        error={null}
      />,
    )
    await user.type(screen.getByLabelText(/Task title/), '   ')
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(screen.getByText('Enter a task title.')).toBeVisible()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits trimmed values and the selected priority', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <TodoForm
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        busy={false}
        error={null}
      />,
    )
    await user.type(screen.getByLabelText(/Task title/), '  Prepare a demo  ')
    await user.selectOptions(screen.getByLabelText('Priority'), 'high')
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Prepare a demo',
      description: '',
      priority: 'high',
      due_date: null,
      completed: false,
    })
  })

  it('submits medium priority for a new task when none is picked', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <TodoForm onSubmit={onSubmit} onCancel={vi.fn()} busy={false} error={null} />,
    )
    await user.type(screen.getByLabelText(/Task title/), 'Prepare a demo')
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 'medium' }),
    )
  })

  it('characterization: shows the error prop as an alert and keeps the entered values', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <TodoForm
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        busy={false}
        error={null}
      />,
    )
    await user.type(screen.getByLabelText(/Task title/), 'Prepare a demo')
    expect(screen.queryByTestId('alert')).not.toBeInTheDocument()
    rerender(
      <TodoForm
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        busy={false}
        error="The server could not save the task."
      />,
    )
    expect(screen.getByTestId('alert')).toHaveTextContent(
      'The server could not save the task.',
    )
    expect(screen.getByLabelText(/Task title/)).toHaveValue('Prepare a demo')
  })

  it('characterization: disables the fields and reads Saving… while busy', () => {
    render(
      <TodoForm onSubmit={vi.fn()} onCancel={vi.fn()} busy error={null} />,
    )
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(screen.getByLabelText(/Task title/)).toBeDisabled()
    expect(screen.getByLabelText('Description (optional)')).toBeDisabled()
  })

  it('characterization: sends a picked due date as YYYY-MM-DD and null once it is cleared', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <TodoForm onSubmit={onSubmit} onCancel={vi.fn()} busy={false} error={null} />,
    )
    await user.type(screen.getByLabelText(/Task title/), 'Prepare a demo')
    const dueDate = screen.getByLabelText('Due date (optional)')
    await user.type(dueDate, '2026-10-20')
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ due_date: '2026-10-20' }),
    )
    await user.clear(dueDate)
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ due_date: null }),
    )
  })

  it('characterization: submits a description with surrounding spaces trimmed', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <TodoForm onSubmit={onSubmit} onCancel={vi.fn()} busy={false} error={null} />,
    )
    await user.type(screen.getByLabelText(/Task title/), 'Prepare a demo')
    await user.type(
      screen.getByLabelText('Description (optional)'),
      '  Bring the slides  ',
    )
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Bring the slides' }),
    )
  })
})
