// results.ts reads reports written by a job that ran PR code: it must emit only numbers and known labels.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { Results } from '../lib/artifacts.ts';
import { runScript, tempDir } from './run.ts';

function resultsFor(files: Record<string, string>): Results {
  const dir = tempDir();
  mkdirSync(join(dir, 'final'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, 'final', name), content);
  const out = join(dir, 'results.json');
  const result = runScript('workflow/results.ts', [dir, '--final-tree', join(dir, 'tree'), '--out', out]);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(readFileSync(out, 'utf8'));
}

describe('results.ts', () => {
  it('turns a passing report into numbers', () => {
    const results = resultsFor({ 'backend.typecheck': 'pass\n', 'backend.vitest.json': JSON.stringify({ success: true, numPassedTests: 3, numFailedTests: 0 }) });
    assert.deepEqual(results.tests.backend, { status: 'pass', passed: 3, failed: 0 });
    assert.equal(results.typecheck.backend, 'pass');
  });

  it('coerces text in a report to 0, so it cannot reach a comment', () => {
    const forged = { success: true, numPassedTests: '<img src=x>', numFailedTests: '@everyone' };
    const results = resultsFor({ 'backend.vitest.json': JSON.stringify(forged) });
    assert.deepEqual(results.tests.backend, { status: 'pass', passed: 0, failed: 0 });
  });

  it('counts a typecheck label it does not know as a failure', () => {
    assert.equal(resultsFor({ 'backend.typecheck': '<b>pass</b>' }).typecheck.backend, 'fail');
  });

  it('counts a missing report as a failure', () => {
    assert.equal(resultsFor({}).tests.backend.status, 'fail');
  });
});
