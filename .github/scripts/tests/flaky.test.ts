// flaky.ts: which test files the Bot commit changed, and which of them failed in the shuffled reruns.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { RERUNS, changedTests, flakyFiles } from '../workflow/flaky.ts';

const write = (root: string, path: string, text: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};

const trees = () => {
  const base = mkdtempSync(join(tmpdir(), 'flaky-'));
  return { head: join(base, 'head'), final: join(base, 'final'), out: join(base, 'out') };
};

type Test = { status: 'passed' | 'failed'; fullName: string };
const report = (tree: string, file: string, tests: Test[], status = tests.some((test) => test.status === 'failed') ? 'failed' : 'passed') => ({
  testResults: [{ name: join(tree, 'backend', file), status, assertionResults: tests }],
});

describe('changedTests', () => {
  it('lists test files that are new or differ from the head, and no unchanged, non-test or source file', () => {
    const { head, final } = trees();
    write(head, 'backend/tests/same.test.ts', 'same');
    write(final, 'backend/tests/same.test.ts', 'same');
    write(head, 'backend/tests/edited.test.ts', 'old');
    write(final, 'backend/tests/edited.test.ts', 'new');
    write(final, 'backend/tests/added.test.ts', 'x');
    write(final, 'backend/tests/fixture.ts', 'x');
    write(final, 'backend/src/thing.test.ts', 'x');
    write(final, 'backend/node_modules/dep/tests/dep.test.ts', 'x');
    assert.deepEqual(changedTests(head, final, 'backend'), ['tests/added.test.ts', 'tests/edited.test.ts']);
  });

  it('follows the frontend test paths and ignores files of the other package', () => {
    const { head, final } = trees();
    write(final, 'frontend/src/a/Card.test.tsx', 'x');
    write(final, 'frontend/src/a/Card.tsx', 'x');
    write(final, 'backend/tests/b.test.ts', 'x');
    assert.deepEqual(changedTests(head, final, 'frontend'), ['src/a/Card.test.tsx']);
  });

  it('finds nothing when the package folder is missing', () => {
    const { head, final } = trees();
    assert.deepEqual(changedTests(head, final, 'frontend'), []);
  });
});

describe('flakyFiles', () => {
  const pass = (final: string) => report(final, 'tests/a.test.ts', [{ status: 'passed', fullName: 'one' }, { status: 'passed', fullName: 'two' }]);
  const fail = (final: string) => report(final, 'tests/a.test.ts', [{ status: 'failed', fullName: 'one' }, { status: 'passed', fullName: 'two' }]);

  it('is empty when no rerun was made, and when every rerun passes', () => {
    const { final, out } = trees();
    assert.deepEqual(flakyFiles(out, final, 'backend'), []);
    write(out, 'backend.rerun.files', 'tests/a.test.ts\n');
    for (let n = 1; n <= RERUNS; n++) write(out, `backend.rerun.${n}.json`, JSON.stringify(pass(final)));
    assert.deepEqual(flakyFiles(out, final, 'backend'), []);
  });

  it('names the file, the failing tests and how many reruns failed', () => {
    const { final, out } = trees();
    write(out, 'backend.rerun.files', 'tests/a.test.ts\n');
    write(out, 'backend.rerun.1.json', JSON.stringify(pass(final)));
    write(out, 'backend.rerun.2.json', JSON.stringify(fail(final)));
    write(out, 'backend.rerun.3.json', JSON.stringify(fail(final)));
    assert.deepEqual(flakyFiles(out, final, 'backend'), [{ file: 'backend/tests/a.test.ts', tests: ['one'], failedReruns: 2, reruns: RERUNS }]);
  });

  it('counts a file that failed to run with no failing test, and a rerun with no report, as flaky', () => {
    const { final, out } = trees();
    write(out, 'backend.rerun.files', 'tests/a.test.ts\n');
    write(out, 'backend.rerun.1.json', JSON.stringify(report(final, 'tests/a.test.ts', [], 'failed')));
    write(out, 'backend.rerun.2.json', JSON.stringify(pass(final)));
    const [flaky] = flakyFiles(out, final, 'backend');
    assert.equal(flaky.failedReruns, 2);
    assert.match(flaky.tests.join('|'), /file failed to run.*no report/);
  });
});
