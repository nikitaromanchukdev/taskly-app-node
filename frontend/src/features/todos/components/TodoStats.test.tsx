import { render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useTodoStatsQuery } from '../hooks/useTodoStatsQuery'
import { TodoStats } from './TodoStats'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('../hooks/useTodoStatsQuery', () => ({ useTodoStatsQuery: vi.fn() }))
beforeEach(() => vi.clearAllMocks())

const stats = {
  total: 6,
  open: 4,
  completed: 2,
  by_priority: { low: 1, medium: 2, high: 3 },
  overdue: 1,
}

function mockQuery(data: typeof stats | undefined) {
  vi.mocked(useTodoStatsQuery).mockReturnValue({
    data,
  } as ReturnType<typeof useTodoStatsQuery>)
}

it('shows open, completed and overdue counters', () => {
  mockQuery(stats)
  render(<TodoStats />)
  const region = screen.getByRole('region', { name: 'Task statistics' })
  expect(region).toHaveTextContent('4 open')
  expect(region).toHaveTextContent('2 completed')
  expect(region).toHaveTextContent('1 overdue')
})

it('shows a zero overdue counter', () => {
  mockQuery({ ...stats, overdue: 0 })
  render(<TodoStats />)
  expect(screen.getByText('0 overdue')).toBeVisible()
})

it('renders nothing while loading or on error', () => {
  mockQuery(undefined)
  const { container } = render(<TodoStats />)
  expect(container).toBeEmptyDOMElement()
})
