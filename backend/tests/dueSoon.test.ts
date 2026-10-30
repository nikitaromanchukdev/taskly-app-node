import { describe, it, expect } from 'vitest';
import { isDueSoon, selectDueSoon } from '../src/features/todos/dueSoon.ts';
import { todo } from './fixture.ts';

const today = new Date('2026-10-16T08:00:00.000Z');
const make = (id: number, due_date: string | null, completed = false) => ({ ...todo, id, due_date, completed });

describe('isDueSoon', () => {
  it('counts a todo due today as due soon', () => {
    expect(isDueSoon(make(1, '2026-10-16'), today, 3)).toBe(true);
  });
  it('counts a todo due before the last day as due soon', () => {
    expect(isDueSoon(make(1, '2026-10-18'), today, 3)).toBe(true);
  });
  it('counts a todo due exactly N days from today as due soon (inclusive)', () => {
    expect(isDueSoon(make(1, '2026-10-19'), today, 3)).toBe(true);
    expect(isDueSoon(make(1, '2026-10-16'), today, 0)).toBe(true);
  });
  it('does not count a todo due the day after the last day', () => {
    expect(isDueSoon(make(1, '2026-10-20'), today, 3)).toBe(false);
    expect(isDueSoon(make(1, '2026-10-17'), today, 0)).toBe(false);
  });
  it('uses the UTC day of today, whatever the time of day', () => {
    const late = new Date('2026-10-16T23:59:59.000Z');
    expect(isDueSoon(make(1, '2026-10-16'), late, 0)).toBe(true);
    expect(isDueSoon(make(1, '2026-10-15'), late, 0)).toBe(false);
    expect(isDueSoon(make(1, '2026-10-19'), late, 3)).toBe(true);
  });
  it('does not count a todo due more than N days away', () => {
    expect(isDueSoon(make(1, '2026-10-20'), today, 3)).toBe(false);
  });
  it('does not count an overdue todo', () => {
    expect(isDueSoon(make(1, '2026-10-15'), today, 3)).toBe(false);
  });
  it('never counts a todo with no due date', () => {
    expect(isDueSoon(make(1, null), today, 30)).toBe(false);
  });
  it('never counts a completed todo', () => {
    expect(isDueSoon(make(1, '2026-10-16', true), today, 3)).toBe(false);
  });
});

describe('selectDueSoon', () => {
  it('keeps only open todos inside the window', () => {
    const todos = [make(1, '2026-10-17'), make(2, '2026-10-17', true), make(3, null), make(4, '2026-10-01'), make(5, '2026-12-01')];
    expect(selectDueSoon(todos, today, 5).map((t) => t.id)).toEqual([1]);
  });
  it('sorts by due date ascending, then by ID ascending', () => {
    const todos = [make(3, '2026-10-18'), make(2, '2026-10-17'), make(1, '2026-10-18'), make(4, '2026-10-16')];
    expect(selectDueSoon(todos, today, 5).map((t) => t.id)).toEqual([4, 2, 1, 3]);
  });
});
