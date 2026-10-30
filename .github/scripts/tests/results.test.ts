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

  describe('thresholds', () => {
    const passing = JSON.stringify({ success: true, numPassedTests: 3, numFailedTests: 0 });
    const failing = JSON.stringify({ success: false, numPassedTests: 1, numFailedTests: 2 });

    it('records a missed coverage floor when every test passed and vitest exited non-zero', () => {
      const results = resultsFor({ 'backend.vitest.json': passing, 'backend.thresholds': 'fail\n', 'frontend.vitest.json': passing, 'frontend.thresholds': 'pass\n' });
      assert.deepEqual(results.thresholds, { backend: 'fail', frontend: 'pass' });
    });

    it('has no figure when a test failed, when the label is unknown or when the file is missing', () => {
      const results = resultsFor({ 'backend.vitest.json': failing, 'backend.thresholds': 'fail', 'frontend.vitest.json': passing, 'frontend.thresholds': '<b>fail</b>' });
      assert.deepEqual(results.thresholds, { backend: 'skipped', frontend: 'skipped' });
      assert.equal(resultsFor({ 'backend.vitest.json': passing }).thresholds.backend, 'skipped');
    });
  });

  it('computes the changed lines a candidate got from scope.json and lcov, as numbers only', () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'final'));
    const lcov = ['SF:' + join(dir, 'tree', 'backend', 'src', 'a.ts'), 'DA:1,1', 'DA:2,0', 'DA:3,0', 'DA:evil,1', 'end_of_record'].join('\n');
    writeFileSync(join(dir, 'final', 'backend.lcov.info'), lcov);
    const scope = { base: 'b', head: 'h', budgets: {}, skipped: [], candidates: [{ path: 'backend/src/a.ts', package: 'backend', status: 'modified', hunks: [{ start: 1, count: 3 }] }] };
    writeFileSync(join(dir, 'scope.json'), JSON.stringify(scope));
    const out = join(dir, 'results.json');
    const result = runScript('workflow/results.ts', [dir, '--final-tree', join(dir, 'tree'), '--scope', join(dir, 'scope.json'), '--out', out]);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')).changedLines, { 'backend/src/a.ts': { covered: 1, total: 3, uncovered: [2, 3] } });
  });
});
