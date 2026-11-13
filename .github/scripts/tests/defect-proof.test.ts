// defect-proof.ts: build leaves the Defect test files for the suites job; decide proves a Defect from a report that PR code wrote.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { AuthorOutput, DefectCase, Proof, Unit } from '../lib/artifacts.ts';
import { buildDefects, judge, missDetail } from '../workflow/defect-proof.ts';
import { runScript, tempDir } from './run.ts';

const FILE = 'backend/tests/stats.test.ts';
const found: DefectCase = {
  package: 'backend',
  path: 'backend/src/stats.ts',
  unit: 'stats',
  file: FILE,
  packageFile: 'tests/stats.test.ts',
  test: 'due today is not overdue',
  expected: '0',
  received: '1',
};

const vitest = (result: object, name = '/work/final/backend/tests/stats.test.ts') => ({
  testResults: [{ name, assertionResults: [{ title: found.test, fullName: `stats ${found.test}`, ...result }] }],
});
const failed = (...failureMessages: string[]) => vitest({ status: 'failed', failureMessages });

describe('judge: a Defect is proven only by an assertion that shows the Author values', () => {
  it('proves a failed assertion that names both values', () => {
    assert.deepEqual(judge(failed('AssertionError: expected 1 to be +0 // Object.is equality\n at x.ts:3'), found), { state: 'proven', reason: '' });
  });

  it('matches loosely: quotes, white space and case', () => {
    const quoted = { ...found, expected: '"Due  Today"', received: "'overdue'" };
    assert.equal(judge(failed("AssertionError: expected 'overdue' to be 'due today'"), quoted).state, 'proven');
  });

  it('proves values the Author wrote in prose, by the literals in them (live run 41044948156)', () => {
    const prose = { ...found, expected: 'ids [2, 3, 1]: the todo with a null due_date comes last', received: 'ids [1, 2, 3]: the null-dated todo comes first' };
    assert.equal(judge(failed('AssertionError: expected [ 1, 2, 3 ] to deeply equal [ 2, 3, 1 ]\n    at /tmp/tree/backend/tests/sort.test.ts:11:51'), prose).state, 'proven');
  });

  it('proves quoted values inside prose', () => {
    const prose = { ...found, expected: "truncate('abcde', 5) returns 'abcde'", received: "'abcd…'" };
    assert.equal(judge(failed("AssertionError: expected 'abcd…' to be 'abcde' // Object.is equality"), prose).state, 'proven');
  });

  it('does not match a bare number against a stack line', () => {
    const numbers = { ...found, expected: '0', received: '51' };
    assert.equal(judge(failed('AssertionError: expected 3 to be +0\n    at /tmp/tree/backend/tests/sort.test.ts:11:51'), numbers).state, 'unproven');
  });

  it('leaves prose values unproven when the runner shows other literals', () => {
    const prose = { ...found, expected: 'ids [2, 3, 1]', received: 'ids [1, 2, 3]' };
    assert.equal(judge(failed('AssertionError: expected [ 3, 2, 1 ] to deeply equal [ 2, 3, 1 ]'), prose).state, 'unproven');
  });

  it('proves a message that starts with "expected" and no error name', () => {
    assert.equal(judge(failed('expected 1 to equal 0'), found).state, 'proven');
  });

  const unprovenCases: [string, unknown, string][] = [
    ['a TypeError', failed("TypeError: Cannot read properties of undefined (reading '1') expected 0 received 1"), 'the test failed with a TypeError'],
    ['a ReferenceError', failed('ReferenceError: stats is not defined'), 'the test failed with a ReferenceError'],
    ['a timeout', failed('Error: Test timed out in 5000ms. expected 0 received 1'), 'the test timed out'],
    ['an import error', failed('Error: Failed to resolve import "../src/stats" from "tests/stats.test.ts"'), 'the test file could not be loaded'],
    ['a plain Error', failed('Error: boom 0 1'), 'the test failed with an error that is not an assertion'],
    ['a pass', vitest({ status: 'passed', failureMessages: [] }), 'the test passed'],
    ['a skipped test', vitest({ status: 'skipped', failureMessages: [] }), 'the test did not run'],
    ['an assertion on other values', failed('AssertionError: expected 7 to be 8'), "the assertion does not show the Author's expected and received values"],
    ['an assertion that names only the expected value', failed('AssertionError: expected 5 to be 0'), "the assertion does not show the Author's expected and received values"],
    ['a failure without a message', failed(), 'the test failed without a message'],
    ['a report of another test', vitest({ status: 'failed', failureMessages: ['AssertionError: expected 1 to be 0'], title: 'other', fullName: 'other' }), 'the test is not in the report'],
    ['a report of another file', vitest({ status: 'failed', failureMessages: ['AssertionError: expected 1 to be 0'] }, '/work/final/backend/tests/other.test.ts'), 'the test is not in the report'],
    ['no report', undefined, 'no report of the Defect test run'],
    ['a report that is not an object', 'proven', 'the test is not in the report'],
    ['a report with failureMessages that are not strings', vitest({ status: 'failed', failureMessages: [{ AssertionError: 1 }] }), 'the test failed without a message'],
  ];
  for (const [name, report, reason] of unprovenCases) {
    it(`leaves a Defect unproven on ${name}`, () => {
      assert.deepEqual(judge(report, found), { state: 'unproven', reason });
    });
  }

  it('never puts report text in the reason', () => {
    const reason = judge(failed('TypeError: <img src=x> @everyone'), found).reason;
    assert.equal(reason, 'the test failed with a TypeError');
  });
});

describe('judge: a test name is matched exactly, by title, full name or test id (live run 41078124349)', () => {
  // The live shape: the name holds " > " and the test sits in a describe.
  const live: DefectCase = { ...found, test: 'clamp with min greater than max > throws a RangeError when min > max', expected: 'clamp(5, 10, 1) throws a RangeError', received: 'No error thrown; clamp returns min (10)' };
  const result = (title: string, ancestorTitles: string[], status = 'failed') => ({
    title,
    ancestorTitles,
    fullName: [...ancestorTitles, title].join(' '),
    status,
    failureMessages: ['AssertionError: expected function to throw an error, but it didn\'t throw anything (clamp(5, 10, 1): RangeError, No error thrown; returns min (10))'],
  });
  const report = (...results: object[]) => ({ testResults: [{ name: '/tmp/tree/backend/tests/stats.test.ts', assertionResults: results }] });
  const mine = result('throws a RangeError when min > max', ['clamp with min greater than max']);

  it('proves a test whose name holds " > ", by describe > name', () => {
    assert.equal(judge(report(mine), live).state, 'proven');
  });

  it('matches by the full name, by the title alone, and by a nested describe', () => {
    assert.equal(judge(report(mine), { ...live, test: 'clamp with min greater than max throws a RangeError when min > max' }).state, 'proven');
    assert.equal(judge(report(mine), { ...live, test: 'throws a RangeError when min > max' }).state, 'proven');
    const nested = result('throws', ['clamp', 'with min > max']);
    assert.equal(judge(report(nested), { ...live, test: 'clamp > with min > max > throws' }).state, 'proven');
  });

  it('does not take another test in the same file for it', () => {
    const other = result('returns min', ['clamp with min greater than max']);
    const sameTitle = result('throws a RangeError when min > max', ['another describe']);
    const tail = result('max', ['clamp with min greater than max']);
    assert.deepEqual(judge(report(other, sameTitle, tail), live), { state: 'unproven', reason: 'the test is not in the report' });
  });

  it('says what was looked for and what the report held, without report text', () => {
    const detail = missDetail(report(result('returns min', ['x'])), live);
    assert.match(detail, /looked for "clamp with min greater than max > throws a RangeError when min > max"/);
    assert.match(detail, /1 file\(s\), 1 of them that file, with 1 test\(s\)/);
    assert.doesNotMatch(detail, /returns min/);
  });
});

describe('judge: a throw assertion proves a Defect when the Author expected a throw (live run 41078124349)', () => {
  const liveMessage = "AssertionError: expected function to throw an error, but it didn't\n    at /tmp/tree/backend/tests/clamp-range-error.test.ts:6:35\n    at file:///tmp/tree/backend/node_modules/@vitest/runner/dist/chunk-artifact.js:302:11";
  const live: DefectCase = { ...found, expected: 'clamp(5, 10, 1) throws a RangeError', received: 'No error thrown; clamp returns min (10)' };
  const withExpected = (expected: string) => ({ ...live, expected });

  it('proves the live message with the live Author values', () => {
    assert.deepEqual(judge(failed(liveMessage), live), { state: 'proven', reason: '' });
  });

  it('proves the other vitest 4 wordings: promise, string or regex argument', () => {
    for (const message of ["AssertionError: expected promise to throw an error, but it didn't", "AssertionError: expected [Function] to throw error including 'min' but got 'x'", 'AssertionError: expected [Function] to throw error matching /min/ but got ""']) {
      assert.equal(judge(failed(message), live).state, 'proven', message);
    }
  });

  it('proves when the Author names only an Error type', () => {
    assert.equal(judge(failed(liveMessage), withExpected('a RangeError for min above max')).state, 'proven');
  });

  it('leaves it unproven when the Author did not expect a throw', () => {
    assert.equal(judge(failed(liveMessage), withExpected('clamp(5, 10, 1) returns 5')).state, 'unproven');
  });

  it('leaves it unproven when the Author expected no throw', () => {
    for (const expected of ['clamp(5, 10, 1) does not throw', 'must never throw a RangeError', "doesn't throw", 'no error is thrown']) {
      assert.equal(judge(failed(liveMessage), withExpected(expected)).state, 'unproven', expected);
    }
  });

  it('leaves a negated throw assertion to the value rule', () => {
    assert.equal(judge(failed("AssertionError: expected [Function] to not throw an error but 'Error: x' was thrown"), live).state, 'unproven');
  });

  it('never proves a crash, even with a throw in the Author text', () => {
    assert.equal(judge(failed("TypeError: x is not a function, expected function to throw an error, but it didn't"), live).state, 'unproven');
    assert.equal(judge(failed('Error: expected function to throw an error'), live).state, 'unproven');
  });
});

const newFile = (path: string, line: string) => `diff --git a/${path} b/${path}\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1 @@\n+${line}\n`;
const existing = (path: string) => `diff --git a/${path} b/${path}\nindex 1..2 100644\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-a\n+b\n`;
const flaggedUnit = (test: string): Unit => ({
  path: found.path,
  unit: 'stats',
  verdict: 'flagged-defect',
  expectations: [],
  attempts: 1,
  defect: { test, expected: '0', received: '1', source: 'PR body' },
});
const authorOf = (...units: Unit[]): AuthorOutput => ({ summary: '', units });

describe('buildDefects', () => {
  it('takes the whole new file of a flagged Defect, and nothing else from the patch', () => {
    const patch = newFile(FILE, `it('${found.test}')`) + newFile('backend/tests/kept.test.ts', 'kept') + existing('backend/tests/old.test.ts');
    const built = buildDefects(authorOf(flaggedUnit(`${FILE} > due today is not overdue`)), patch);
    assert.deepEqual(built.cases, [found]);
    assert.equal(built.patch, newFile(FILE, `it('${found.test}')`));
  });

  it('keeps the describe and the whole name when the name holds " > "', () => {
    const name = 'throws a RangeError when min > max';
    const built = buildDefects(authorOf(flaggedUnit(`${FILE} > clamp with min greater than max > ${name}`)), newFile(FILE, `it('${name}')`));
    assert.deepEqual(built.cases.map((c) => c.test), [`clamp with min greater than max > ${name}`]);
  });

  it('keeps a file once when two Defects share it', () => {
    const two = [flaggedUnit(`${FILE} > a`), { ...flaggedUnit(`${FILE} > b`), unit: 'other' }];
    const built = buildDefects(authorOf(...two), newFile(FILE, "it('a'); it('b')"));
    assert.equal(built.cases.length, 2);
    assert.equal(built.patch, newFile(FILE, "it('a'); it('b')"));
  });

  it('skips a Defect whose test file is not new in the patch, or not in a package', () => {
    const built = buildDefects(authorOf(flaggedUnit(`${FILE} > a`), { ...flaggedUnit('docs/x.test.ts > a'), unit: 'u2' }), existing(FILE) + newFile('docs/x.test.ts', 'x'));
    assert.deepEqual(built.cases, []);
    assert.equal(built.patch, '');
  });

  it('builds nothing for a Defect whose test is not in the new file: the Author removed it', () => {
    const patch = newFile(FILE, "it('another test')");
    const built = buildDefects(authorOf(flaggedUnit(`${FILE} > due today is not overdue`)), patch);
    assert.deepEqual(built.cases, []);
    assert.equal(built.patch, '');
  });

  it('builds only the Defect whose test is in the file', () => {
    const header = `diff --git a/${FILE} b/${FILE}\nnew file mode 100644\n--- /dev/null\n+++ b/${FILE}\n@@ -0,0 +1 @@\n+it('kept')\n`;
    const two = [flaggedUnit(`${FILE} > due today is not overdue`), { ...flaggedUnit(`${FILE} > kept`), unit: 'other' }];
    const built = buildDefects(authorOf(...two), header);
    assert.deepEqual(built.cases.map((c) => c.unit), ['other']);
  });

  it('skips Units that are not flagged Defects', () => {
    const added: Unit = { ...flaggedUnit('x > a'), verdict: 'added', defect: undefined };
    assert.deepEqual(buildDefects(authorOf(added), newFile(FILE, "it('a'); it('b')")).cases, []);
  });
});

describe('defect-proof.ts as the workflow runs it', () => {
  it('build writes defects.patch and defects.json, and decide writes proof.json from the reports', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'author.json'), JSON.stringify(authorOf(flaggedUnit(`${FILE} > due today is not overdue`))));
    writeFileSync(join(dir, 'tests.patch'), newFile(FILE, `it('${found.test}')`));
    const built = runScript('workflow/defect-proof.ts', ['build', join(dir, 'author.json'), '--patch', join(dir, 'tests.patch'), '--out-dir', join(dir, 'defects')]);
    assert.equal(built.code, 0, built.stderr);
    assert.equal(readFileSync(join(dir, 'defects/defects.patch'), 'utf8'), newFile(FILE, `it('${found.test}')`));

    mkdirSync(join(dir, 'reports'));
    writeFileSync(join(dir, 'reports/backend.defects.json'), JSON.stringify(failed('AssertionError: expected 1 to be 0')));
    const out = join(dir, 'proof.json');
    const decided = runScript('workflow/defect-proof.ts', ['decide', join(dir, 'defects/defects.json'), '--reports', join(dir, 'reports'), '--out', out]);
    assert.equal(decided.code, 0, decided.stderr);
    const proofs: Proof[] = JSON.parse(readFileSync(out, 'utf8'));
    assert.deepEqual(proofs, [{ path: found.path, unit: 'stats', state: 'proven', reason: '' }]);

    writeFileSync(join(dir, 'reports/backend.defects.json'), '{ not json');
    runScript('workflow/defect-proof.ts', ['decide', join(dir, 'defects/defects.json'), '--reports', join(dir, 'reports'), '--out', out]);
    assert.equal(JSON.parse(readFileSync(out, 'utf8'))[0].state, 'unproven');
  });

  it('build writes nothing when no Defect has a test file in the patch', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'author.json'), JSON.stringify(authorOf()));
    writeFileSync(join(dir, 'tests.patch'), '');
    const built = runScript('workflow/defect-proof.ts', ['build', join(dir, 'author.json'), '--patch', join(dir, 'tests.patch'), '--out-dir', join(dir, 'defects')]);
    assert.equal(built.code, 0, built.stderr);
    assert.equal(existsSync(join(dir, 'defects')), false);
  });
});
