import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import type { Todo } from '../types'
import { useTodoFilters } from './useTodoFilters'

const plan: Todo = {
  ...todoFixture,
  id: 1,
  title: 'Plan the API review',
  description: '',
}
const milk: Todo = {
  ...todoFixture,
  id: 2,
  title: 'Buy milk',
  description: 'Ask about api access',
}
const call: Todo = {
  ...todoFixture,
  id: 3,
  title: 'Call mom',
  description: '',
  completed: true,
}

it('starts with all statuses, an empty search and newest first', () => {
  const { result } = renderHook(() => useTodoFilters([plan, milk, call]))
  expect(result.current.filter).toBe('all')
  expect(result.current.search).toBe('')
  expect(result.current.sort).toBe('newest')
})

it('shows only tasks whose title or description contains the search, ignoring case', () => {
  const { result } = renderHook(() => useTodoFilters([plan, milk, call]))
  act(() => {
    result.current.setSearch('API')
  })
  expect(result.current.visible.map((todo) => todo.id).sort()).toEqual([1, 2])
})

it('shows only completed tasks after the filter is set to completed', () => {
  const { result } = renderHook(() => useTodoFilters([plan, milk, call]))
  act(() => {
    result.current.setFilter('completed')
  })
  expect(result.current.visible.map((todo) => todo.id)).toEqual([3])
})
