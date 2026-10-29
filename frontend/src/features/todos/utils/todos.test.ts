import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatDate, isOverdue, selectTodos, validateTodo } from './todos'
import type { Todo, TodoInput } from '../types'

const base: Todo = {
  id: 1,
  title: 'Sprint plan',
  description: '',
  priority: 'medium',
  completed: false,
  due_date: null,
  created_at: '2026-10-01T12:00:00Z',
  updated_at: '2026-10-01T12:00:00Z',
}

const input: TodoInput = {
  title: 'Prepare a demo',
  description: '',
  priority: 'medium',
  due_date: null,
  completed: false,
}

function pinToNoonOn15October() {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 15, 12))
}

describe('selectTodos', () => {
  it('combines status with a case-insensitive search in the description', () => {
    const matching = { ...base, description: 'Discuss the API' }
    const todos = [
      matching,
      { ...matching, id: 2, completed: true },
      { ...base, id: 3 },
    ]
    expect(selectTodos(todos, 'active', ' api ', 'newest')).toEqual([matching])
  })

  it('keeps completed and active tasks for the all filter', () => {
    const done: Todo = { ...base, id: 2, completed: true }
    const result = selectTodos([base, done], 'all', '', 'newest')
    expect(result).toHaveLength(2)
    expect(result).toEqual(expect.arrayContaining([base, done]))
  })

  it('sorts by priority without changing the source array', () => {
    const high: Todo = { ...base, id: 2, priority: 'high' }
    const todos = [base, high]
    expect(selectTodos(todos, 'all', '', 'priority')).toEqual([high, base])
    expect(todos).toEqual([base, high])
  })

  it('orders by priority high, medium, low regardless of id or creation time', () => {
    const low: Todo = {
      ...base,
      id: 3,
      priority: 'low',
      created_at: '2026-10-05T12:00:00Z',
    }
    const medium: Todo = {
      ...base,
      id: 2,
      priority: 'medium',
      created_at: '2026-10-03T12:00:00Z',
    }
    const high: Todo = {
      ...base,
      id: 1,
      priority: 'high',
      created_at: '2026-10-01T12:00:00Z',
    }
    expect(
      selectTodos([low, medium, high], 'all', '', 'priority').map(
        (todo) => todo.id,
      ),
    ).toEqual([1, 2, 3])
  })

  it('orders the newest tasks first and breaks equal times by higher id', () => {
    const older = {
      ...base,
      id: 1,
      created_at: '2026-10-01T12:00:00Z',
      due_date: '2026-10-02',
    }
    const newer = {
      ...base,
      id: 2,
      created_at: '2026-10-03T12:00:00Z',
      due_date: '2026-10-30',
    }
    const sameTimeHigherId = {
      ...base,
      id: 4,
      created_at: '2026-10-03T12:00:00Z',
      due_date: null,
    }
    const lowerIdNewest = {
      ...base,
      id: 3,
      created_at: '2026-10-04T12:00:00Z',
      due_date: '2026-10-10',
    }
    expect(
      selectTodos(
        [older, newer, sameTimeHigherId, lowerIdNewest],
        'all',
        '',
        'newest',
      ).map((todo) => todo.id),
    ).toEqual([3, 4, 2, 1])
  })

  it('sorts by due date with undated tasks last', () => {
    const later = { ...base, id: 1, due_date: '2026-10-20' }
    const sooner = { ...base, id: 2, due_date: '2026-10-10' }
    const undated = { ...base, id: 3, due_date: null }
    const twinLower = { ...base, id: 4, due_date: '2026-10-20' }
    const twinHigher = { ...base, id: 5, due_date: '2026-10-20' }
    expect(
      selectTodos(
        [later, undated, sooner, twinLower, twinHigher],
        'all',
        '',
        'due',
      ).map((todo) => todo.id),
    ).toEqual([2, 5, 4, 1, 3])
  })

  it('breaks equal priorities by the higher id first', () => {
    const first: Todo = { ...base, id: 3, priority: 'high' }
    const second: Todo = { ...base, id: 9, priority: 'high' }
    expect(
      selectTodos([first, second], 'all', '', 'priority').map(
        (todo) => todo.id,
      ),
    ).toEqual([9, 3])
  })

  it('returns only completed tasks for the completed filter', () => {
    const done: Todo = { ...base, id: 2, completed: true }
    expect(selectTodos([base, done], 'completed', '', 'newest')).toEqual([done])
  })
})

describe('validateTodo', () => {
  it('rejects a title longer than 120 characters', () => {
    expect(validateTodo({ ...input, title: 'x'.repeat(121) })).toEqual({
      title: 'The title must be at most 120 characters.',
    })
  })

  it('accepts a title of exactly 120 characters', () => {
    expect(validateTodo({ ...input, title: 'x'.repeat(120) })).toEqual({})
  })

  it('rejects a description longer than 2000 characters', () => {
    expect(
      validateTodo({ ...input, description: 'x'.repeat(2001) }),
    ).toEqual({
      description: 'The description must be at most 2000 characters.',
    })
  })

  it('accepts a description of exactly 2000 characters', () => {
    expect(
      validateTodo({ ...input, description: 'x'.repeat(2000) }),
    ).toEqual({})
  })

  it('measures the title and description length after trimming', () => {
    expect(
      validateTodo({
        ...input,
        title: `  ${'x'.repeat(120)}  `,
        description: ` ${'x'.repeat(2000)} `,
      }),
    ).toEqual({})
  })

  it.each(['2026-02-30', '2025-02-29'])(
    'rejects the impossible calendar date %s',
    (due_date) => {
      expect(validateTodo({ ...input, due_date })).toEqual({
        due_date: 'Enter a valid date.',
      })
    },
  )

  it('rejects a date in the right format that does not exist (2026-13-01)', () => {
    expect(validateTodo({ ...input, due_date: '2026-13-01' })).toEqual({
      due_date: 'Enter a valid date.',
    })
  })

  it('accepts 29 February in a leap year', () => {
    expect(validateTodo({ ...input, due_date: '2024-02-29' })).toEqual({})
  })
})

describe('isOverdue', () => {
  beforeEach(pinToNoonOn15October)
  afterEach(() => {
    vi.useRealTimers()
  })

  const openTask = (due_date: string | null, completed = false): Todo => ({
    ...base,
    due_date,
    completed,
  })

  it('is true for an open task due before today', () => {
    expect(isOverdue(openTask('2026-10-14'))).toBe(true)
  })

  it('is false for a task due today', () => {
    expect(isOverdue(openTask('2026-10-15'))).toBe(false)
  })

  it('is false for a task due after today', () => {
    expect(isOverdue(openTask('2026-10-16'))).toBe(false)
  })

  it('is false for a completed task or a task without a due date', () => {
    expect(isOverdue(openTask('2026-10-14', true))).toBe(false)
    expect(isOverdue(openTask(null))).toBe(false)
  })

  it('compares zero-padded dates in single-digit months and days', () => {
    vi.setSystemTime(new Date(2026, 2, 5, 12))
    expect(isOverdue(openTask('2026-03-04'))).toBe(true)
    expect(isOverdue(openTask('2026-03-05'))).toBe(false)
  })
})

describe('formatDate', () => {
  beforeEach(pinToNoonOn15October)
  afterEach(() => {
    vi.useRealTimers()
  })

  it('formats a calendar date as day, short month and year', () => {
    expect(formatDate('2026-10-15')).toBe('15 Oct 2026')
  })
})
