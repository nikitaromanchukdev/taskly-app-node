import { describe, it, expect } from 'vitest';
import { sortForTriage } from '../src/features/todos/sort.ts';
import { todo } from './fixture.ts';
import type { Todo } from '../src/features/todos/types.ts';

const make = (id: number, priority: Todo['priority'], due_date: string | null): Todo => ({ ...todo, id, priority, due_date });
const ids = (list: Todo[]) => list.map((t) => t.id);

describe('sortForTriage', () => {
  it('orders by priority: high, then medium, then low', () => {
    const input = [make(1, 'low', null), make(2, 'high', null), make(3, 'medium', null)];
    expect(ids(sortForTriage(input))).toEqual([2, 3, 1]);
  });

  it('orders by due date, earliest first, within the same priority', () => {
    const input = [make(1, 'high', '2026-12-01'), make(2, 'high', '2026-10-01'), make(3, 'high', '2026-11-01')];
    expect(ids(sortForTriage(input))).toEqual([2, 3, 1]);
  });

  it('keeps input order for the same priority and due date', () => {
    const input = [make(1, 'medium', '2026-10-01'), make(2, 'medium', '2026-10-01'), make(3, 'medium', '2026-10-01')];
    expect(ids(sortForTriage(input))).toEqual([1, 2, 3]);
  });

  it('keeps input order among todos without a due date in the same priority', () => {
    const input = [make(1, 'low', null), make(2, 'low', null)];
    expect(ids(sortForTriage(input))).toEqual([1, 2]);
  });

  it('returns a new array and does not change the input', () => {
    const input = [make(1, 'low', null), make(2, 'high', null)];
    const result = sortForTriage(input);
    expect(result).not.toBe(input);
    expect(ids(input)).toEqual([1, 2]);
  });
});
