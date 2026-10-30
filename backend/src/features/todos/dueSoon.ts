import type { Todo } from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function dayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isDueSoon(todo: Todo, today: Date, days: number): boolean {
  if (todo.completed || !todo.due_date) return false;
  const todayDay = dayString(today);
  const lastDay = dayString(new Date(today.getTime() + days * DAY_MS));
  return todo.due_date >= todayDay && todo.due_date < lastDay;
}

export function selectDueSoon(todos: Todo[], today: Date, days: number): Todo[] {
  return todos
    .filter((todo) => isDueSoon(todo, today, days))
    .sort((a, b) => {
      const byDate = (a.due_date as string).localeCompare(b.due_date as string);
      return byDate !== 0 ? byDate : a.id - b.id;
    });
}
