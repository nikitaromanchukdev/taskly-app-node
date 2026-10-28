import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useTodoStatsQuery } from '../hooks/useTodoStatsQuery'
import { TodoStats } from './TodoStats'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('../hooks/useTodoStatsQuery', () => ({ useTodoStatsQuery: vi.fn() }))

const stats = {
  total: 6,
  open: 4,
  completed: 2,
  by_priority: { low: 2, medium: 2, high: 2 },
  overdue: 1,
}

it('shows open, completed and overdue counters', () => {
  vi.mocked(useTodoStatsQuery).mockReturnValue({ data: stats } as never)
  render(<TodoStats />)
  const region = screen.getByRole('region', { name: 'Task statistics' })
  expect(region).toHaveTextContent('4 open')
  expect(region).toHaveTextContent('2 completed')
  expect(region).toHaveTextContent('1 overdue')
})

it.each([
  ['loading', { data: undefined, isPending: true }],
  ['error', { data: undefined, isError: true }],
])('renders nothing while %s', (_name, state) => {
  vi.mocked(useTodoStatsQuery).mockReturnValue(state as never)
  const { container } = render(<TodoStats />)
  expect(container).toBeEmptyDOMElement()
})
