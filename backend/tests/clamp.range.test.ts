import { describe, it, expect } from 'vitest';
import { clamp } from '../src/core/clamp.ts';

describe('clamp range errors', () => {
  it('throws a RangeError when min is greater than max', () => {
    expect(() => clamp(5, 10, 1)).toThrow(RangeError);
  });

  it('returns min when value is below min', () => {
    expect(clamp(-3, 0, 10)).toBe(0);
  });
});
