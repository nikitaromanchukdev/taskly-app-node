import { Badge } from '../../../design-system'
import { useTodoStatsQuery } from '../hooks/useTodoStatsQuery'

export function TodoStats() {
  const { data } = useTodoStatsQuery()
  if (!data) return null
  return (
    <section className="row" aria-label="Task statistics">
      <Badge variant="info">{data.open} open</Badge>
      <Badge variant="success">{data.completed} completed</Badge>
      <Badge variant={data.overdue > 0 ? 'warning' : 'neutral'}>
        {data.overdue} overdue
      </Badge>
    </section>
  )
}
