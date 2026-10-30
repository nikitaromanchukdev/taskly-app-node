// prepare.ts caps the candidates one run sends to the Author (ADR 0002).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { Candidate, Scope } from '../lib/artifacts.ts';
import { MAX_CANDIDATES } from '../contracts/rules.ts';
import { capCandidates } from '../workflow/prepare.ts';
import { runScript, tempDir } from './run.ts';

const file = (name: string, lines: number): Candidate => ({
  path: `backend/src/${name}.ts`,
  package: 'backend',
  status: 'modified',
  hunks: [{ start: 1, count: lines }],
});

const scopeOf = (candidates: Candidate[]): Scope => ({
  base: 'a',
  head: 'b',
  budgets: { model: 'm', reviewerModel: 'r', maxTurns: 1, timeoutMinutes: 1, maxAttempts: 1 },
  candidates,
  skipped: [{ path: 'README.md', reason: 'docs' }],
});

describe('capCandidates', () => {
  it('leaves a scope within the cap unchanged', () => {
    const scope = scopeOf([file('a', 1), file('b', 2)]);
    assert.deepEqual(capCandidates(scope, 2), scope);
  });

  it('keeps the files with the most changed lines and skips the rest as over-cap', () => {
    const scope = capCandidates(scopeOf([file('small', 1), file('big', 50), file('mid', 10)]), 2);
    assert.deepEqual(scope.candidates.map((c) => c.path), ['backend/src/big.ts', 'backend/src/mid.ts']);
    assert.deepEqual(scope.skipped, [
      { path: 'README.md', reason: 'docs' },
      { path: 'backend/src/small.ts', reason: 'over-cap' },
    ]);
  });

  it('breaks ties by path and keeps the diff order of the kept files', () => {
    const scope = capCandidates(scopeOf([file('c', 5), file('b', 5), file('a', 5)]), 2);
    assert.deepEqual(scope.candidates.map((c) => c.path), ['backend/src/b.ts', 'backend/src/a.ts']);
    assert.deepEqual(scope.skipped.at(-1), { path: 'backend/src/c.ts', reason: 'over-cap' });
  });

  it('sums the lines of all hunks of a file', () => {
    const split: Candidate = { ...file('split', 1), hunks: [{ start: 1, count: 4 }, { start: 20, count: 4 }] };
    const scope = capCandidates(scopeOf([file('one', 6), split]), 1);
    assert.deepEqual(scope.candidates.map((c) => c.path), ['backend/src/split.ts']);
  });

  it('uses MAX_CANDIDATES by default', () => {
    const many = Array.from({ length: MAX_CANDIDATES + 3 }, (_, i) => file(`f${String(i).padStart(2, '0')}`, 1));
    const scope = capCandidates(scopeOf(many));
    assert.equal(scope.candidates.length, MAX_CANDIDATES);
    assert.equal(scope.skipped.filter((s) => s.reason === 'over-cap').length, 3);
  });
});

describe('prepare.ts --local', () => {
  it('writes scope.json with the files over the cap listed as skipped', () => {
    const root = tempDir();
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@localhost', ...args], { cwd: root });
    git('init', '-q', '-b', 'main');
    git('commit', '-q', '--allow-empty', '-m', 'init');
    git('switch', '-q', '-c', 'feature');
    mkdirSync(join(root, 'backend/src'), { recursive: true });
    for (let i = 0; i < MAX_CANDIDATES + 2; i++) {
      writeFileSync(join(root, `backend/src/f${String(i).padStart(2, '0')}.ts`), 'x\n'.repeat(i + 1));
    }
    git('add', '.');
    git('commit', '-q', '-m', 'many');
    const env = { TEST_AGENT_MODEL: 'm', TEST_AGENT_REVIEWER_MODEL: 'r', TEST_AGENT_MAX_TURNS: '5', TEST_AGENT_TIMEOUT_MINUTES: '5', TEST_AGENT_MAX_ATTEMPTS: '2' };
    const exit = runScript('workflow/prepare.ts', ['--local', 'main', '--out', join(root, 'scope.json')], { cwd: root, env });
    assert.equal(exit.code, 0, exit.stderr);
    const scope = JSON.parse(readFileSync(join(root, 'scope.json'), 'utf8')) as Scope;
    assert.equal(scope.candidates.length, MAX_CANDIDATES);
    assert.deepEqual(scope.skipped, [
      { path: 'backend/src/f00.ts', reason: 'over-cap' },
      { path: 'backend/src/f01.ts', reason: 'over-cap' },
    ]);
  });
});
