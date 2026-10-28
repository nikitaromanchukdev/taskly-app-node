import type { Todo, TodoStats } from './types.js';

export function computeTodoStats(todos: Todo[], today: Date): TodoStats {
  const todayDay = today.toISOString().slice(0, 10);
  const stats: TodoStats = {
    total: todos.length,
    open: 0,
    completed: 0,
    by_priority: { low: 0, medium: 0, high: 0 },
    overdue: 0,
  };
  for (const todo of todos) {
    stats.by_priority[todo.priority] += 1;
    if (todo.completed) {
      stats.completed += 1;
      continue;
    }
    stats.open += 1;
    const dueDay = todo.due_date;
    if (dueDay && dueDay <= todayDay) stats.overdue += 1;
  }
  return stats;
}
