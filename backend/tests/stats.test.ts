import { describe, it, expect } from 'vitest';
import { computeTodoStats } from '../src/features/todos/stats.ts';
import { todo } from './fixture.ts';

const today = new Date('2026-10-15T10:30:00.000Z');

describe('computeTodoStats', () => {
  it('returns zero counts with all priority keys for no todos', () => {
    expect(computeTodoStats([], today)).toEqual({
      total: 0, open: 0, completed: 0, by_priority: { low: 0, medium: 0, high: 0 }, overdue: 0,
    });
  });
  it('counts open and completed by the completed flag', () => {
    const stats = computeTodoStats([{ ...todo, id: 1 }, { ...todo, id: 2, completed: true }, { ...todo, id: 3, completed: true }], today);
    expect(stats).toMatchObject({ total: 3, open: 1, completed: 2 });
  });
  it('counts priorities across open and completed todos', () => {
    const stats = computeTodoStats([
      { ...todo, priority: 'low' }, { ...todo, priority: 'high', completed: true }, { ...todo, priority: 'high' },
    ], today);
    expect(stats.by_priority).toEqual({ low: 1, medium: 0, high: 2 });
  });
  it('counts an open todo due before today as overdue', () => {
    expect(computeTodoStats([{ ...todo, due_date: '2026-10-14' }], today).overdue).toBe(1);
  });
  it('does not count a todo due after today as overdue', () => {
    expect(computeTodoStats([{ ...todo, due_date: '2026-10-16' }], today).overdue).toBe(0);
  });
  it('never counts completed todos or todos without a due date as overdue', () => {
    const stats = computeTodoStats([{ ...todo, due_date: '2026-10-01', completed: true }, { ...todo, due_date: null }], today);
    expect(stats.overdue).toBe(0);
  });
  it('uses the UTC calendar date as today', () => {
    expect(computeTodoStats([{ ...todo, due_date: '2026-10-15' }], new Date('2026-10-16T00:00:00.000Z')).overdue).toBe(1);
  });
});
