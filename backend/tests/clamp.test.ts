import { describe, it, expect } from 'vitest';
import { clamp } from '../src/core/clamp.ts';

describe('clamp', () => {
  it('returns min when value is below min', () => {
    expect(clamp(1, 5, 10)).toBe(5);
  });

  it('returns max when value is above max', () => {
    expect(clamp(11, 5, 10)).toBe(10);
  });

  it('returns value when within range', () => {
    expect(clamp(7, 5, 10)).toBe(7);
  });

  it('returns the value at the exact bounds', () => {
    expect(clamp(5, 5, 10)).toBe(5);
    expect(clamp(10, 5, 10)).toBe(10);
  });
});
