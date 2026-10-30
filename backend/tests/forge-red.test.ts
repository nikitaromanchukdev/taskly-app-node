// Throwaway: fails on purpose so the real test-agent/verify status is red (live forged-status check, PR #77).
import { expect, it } from 'vitest';

it('fails on purpose', () => {
  expect(1).toBe(2);
});
