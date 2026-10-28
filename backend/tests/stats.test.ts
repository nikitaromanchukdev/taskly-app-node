import { describe, it, expect } from 'vitest';
import { computeTodoStats } from '../src/features/todos/stats.ts';
import { todo } from './fixture.ts';

const today = new Date('2026-10-15T12:00:00.000Z');

describe('computeTodoStats', () => {
  it('returns zero counts and all priority keys for no todos', () => {
    expect(computeTodoStats([], today)).toEqual({
      total: 0, open: 0, completed: 0, by_priority: { low: 0, medium: 0, high: 0 }, overdue: 0,
    });
  });

  it('counts open and completed by the completed flag', () => {
    const stats = computeTodoStats([todo, { ...todo, id: 2 }, { ...todo, id: 3, completed: true }], today);
    expect(stats.total).toBe(3);
    expect(stats.open).toBe(2);
    expect(stats.completed).toBe(1);
  });

  it('counts priorities across open and completed todos', () => {
    const stats = computeTodoStats([
      { ...todo, priority: 'low' },
      { ...todo, priority: 'low', completed: true },
      { ...todo, priority: 'high' },
    ], today);
    expect(stats.by_priority).toEqual({ low: 2, medium: 0, high: 1 });
  });

  it('counts an open todo due before today as overdue', () => {
    expect(computeTodoStats([{ ...todo, due_date: '2026-10-14' }], today).overdue).toBe(1);
  });

  it('does not count a todo due today as overdue', () => {
    expect(computeTodoStats([{ ...todo, due_date: '2026-10-15' }], today).overdue).toBe(0);
  });

  it('does not count a todo due after today as overdue', () => {
    expect(computeTodoStats([{ ...todo, due_date: '2026-10-16' }], today).overdue).toBe(0);
  });

  it('never counts completed todos or todos without due date as overdue', () => {
    const stats = computeTodoStats([
      { ...todo, due_date: '2026-10-01', completed: true },
      { ...todo, due_date: null },
    ], today);
    expect(stats.overdue).toBe(0);
  });

  it('uses the UTC calendar date of today', () => {
    const lateUtc = new Date('2026-10-15T23:59:59.000Z');
    expect(computeTodoStats([{ ...todo, due_date: '2026-10-14' }], lateUtc).overdue).toBe(1);
  });
});
