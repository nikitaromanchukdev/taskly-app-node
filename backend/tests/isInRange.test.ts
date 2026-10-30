import { describe, it, expect } from 'vitest';
import { isInRange } from '../src/core/clamp.ts';

describe('isInRange', () => {
  it('characterization: returns true for a value inside the range', () => {
    expect(isInRange(7, 5, 10)).toBe(true);
  });

  it('characterization: includes both bounds', () => {
    expect(isInRange(5, 5, 10)).toBe(true);
    expect(isInRange(10, 5, 10)).toBe(true);
  });

  it('characterization: returns false outside the range', () => {
    expect(isInRange(4, 5, 10)).toBe(false);
    expect(isInRange(11, 5, 10)).toBe(false);
  });
});
