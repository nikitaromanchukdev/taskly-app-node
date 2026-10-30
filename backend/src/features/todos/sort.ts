import type { Todo } from './types.js';

const PRIORITY_RANK: Record<Todo['priority'], number> = { high: 0, medium: 1, low: 2 };

function compareDueDate(a: Todo['due_date'], b: Todo['due_date']): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
}

export function sortForTriage(todos: readonly Todo[]): Todo[] {
  return [...todos].sort(
    (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || compareDueDate(a.due_date, b.due_date),
  );
}
