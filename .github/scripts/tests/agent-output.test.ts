// agent-output.ts checks both agents' output before the Bot commit, and decides which test files to drop.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { AuthorOutput, Checked, Finding, ReviewerOutput, Unit } from '../lib/artifacts.ts';
import { runScript, tempDir } from './run.ts';

type Inputs = { author: unknown; reviewer?: unknown; patch?: string; maxAttempts?: string };
type Outcome = { code: number | null; stderr: string; checked: Checked };

const TEST = 'backend/tests/todos.test.ts > counts open todos';
const CHARACTERIZATION_TEST = 'backend/tests/todos.test.ts > characterization: sorts by id';

const unit = (overrides: Partial<Unit> = {}): Unit => ({
  path: 'backend/src/todos.ts',
  unit: 'countOpen',
  verdict: 'added',
  expectations: [
    { text: 'counts open todos', source: 'PR body', kind: 'intent', tests: [TEST] },
    { text: 'sorts by id', source: 'none; current behaviour', kind: 'characterization', tests: [CHARACTERIZATION_TEST] },
  ],
  attempts: 0,
  ...overrides,
});

const flagged = (test = 'backend/tests/stats.test.ts > due today is not overdue'): Unit => ({
  path: 'backend/src/stats.ts',
  unit: 'stats',
  verdict: 'flagged-defect',
  expectations: [],
  attempts: 1,
  defect: { test, expected: '0', received: '1', source: 'PR body' },
});

const author = (...units: Unit[]): AuthorOutput => ({ summary: 'summary', units });
const reviewer = (findings: Finding[] = [], defects: ReviewerOutput['defects'] = []): ReviewerOutput => ({ summary: 'summary', findings, defects });
const confirmed = { path: 'backend/src/stats.ts', unit: 'stats', decision: 'confirmed' as const, source_quote: 'due today is not overdue' };

// Writes the inputs to files and runs the CLI, as the commit job does.
function check({ author, reviewer, patch, maxAttempts = '3' }: Inputs): Outcome {
  const dir = tempDir();
  const file = (name: string, content: string) => {
    writeFileSync(join(dir, name), content);
    return join(dir, name);
  };
  const args = [file('author.json', JSON.stringify(author)), '--max-attempts', maxAttempts, '--out', join(dir, 'checked.json')];
  if (reviewer !== undefined) args.push('--reviewer', file('reviewer.json', JSON.stringify(reviewer)));
  if (patch !== undefined) args.push('--patch', file('tests.patch', patch));
  const result = runScript('workflow/agent-output.ts', args);
  return { code: result.code, stderr: result.stderr, checked: JSON.parse(readFileSync(join(dir, 'checked.json'), 'utf8')) };
}

const addedFile = (path: string, lines: readonly string[], isNew = true) =>
  [`diff --git a/${path} b/${path}`, ...(isNew ? ['new file mode 100644', '--- /dev/null'] : [`--- a/${path}`]), `+++ b/${path}`, '@@ -0,0 +1 @@', ...lines.map((line) => `+${line}`), ''].join('\n');

const rejects = (inputs: Inputs, error: RegExp) => {
  const outcome = check(inputs);
  assert.equal(outcome.code, 1);
  assert.equal(outcome.checked.ok, false);
  assert.match(outcome.stderr, error);
};

describe('agent-output.ts', () => {
  it('accepts valid output and drops nothing', () => {
    const outcome = check({ author: author(unit()), reviewer: reviewer() });
    assert.equal(outcome.code, 0);
    assert.deepEqual(outcome.checked, { ok: true, errors: [], dropFiles: [], reviewRejected: [] });
  });

  it('rejects output that breaks the schema', () => {
    const { kind: _kind, ...noKind } = unit().expectations[0];
    rejects({ author: author(unit({ expectations: [noKind as never] })), reviewer: reviewer() }, /author .*kind/);
  });

  it('rejects more attempts than the budget', () => {
    rejects({ author: author(unit({ attempts: 4 })), reviewer: reviewer() }, /attempts 4 outside 0\.\.3/);
  });

  it('rejects an intent test whose name says characterization', () => {
    const expectations = [{ text: 'sorts by id', source: 'PR body', kind: 'intent' as const, tests: [CHARACTERIZATION_TEST] }];
    rejects({ author: author(unit({ expectations })), reviewer: reviewer() }, /kind intent, so its name must not start with/);
  });

  it('rejects a characterization test whose name does not say so', () => {
    const expectations = [{ text: 'counts open todos', source: 'none', kind: 'characterization' as const, tests: [TEST] }];
    rejects({ author: author(unit({ expectations })), reviewer: reviewer() }, /kind characterization, so its name must start with/);
  });

  it('rejects a test listed under two Expectations', () => {
    const expectations = [
      { text: 'a', source: 'PR body', kind: 'intent' as const, tests: [TEST] },
      { text: 'b', source: 'PR body', kind: 'intent' as const, tests: [TEST] },
    ];
    rejects({ author: author(unit({ expectations })), reviewer: reviewer() }, /listed under more than one Expectation/);
  });

  it('rejects a tested Unit with no tests', () => {
    rejects({ author: author(unit({ expectations: [] })), reviewer: reviewer() }, /added lists no tests/);
  });

  it('rejects a not-needed Unit without a reason', () => {
    rejects({ author: author(unit({ verdict: 'not-needed', expectations: [] })) }, /not-needed needs reason/);
  });

  it('rejects the same Unit listed twice', () => {
    rejects({ author: author(unit(), unit()), reviewer: reviewer() }, /listed more than once/);
  });

  it('rejects tests without a Reviewer output', () => {
    rejects({ author: author(unit()) }, /reviewer\.json is missing/);
  });

  it('needs no Reviewer output when nothing was tested', () => {
    assert.equal(check({ author: author(unit({ verdict: 'not-needed', reason: 'trivial', expectations: [] })) }).code, 0);
  });

  it('rejects a Finding on a test the Author did not write', () => {
    const finding: Finding = { test: 'backend/tests/other.test.ts > x', severity: 'advisory', reason: 'flaky', note: '' };
    rejects({ author: author(unit()), reviewer: reviewer([finding]) }, /unknown test/);
  });

  it('rejects a flagged Defect the Reviewer did not decide', () => {
    rejects({ author: author(flagged()), reviewer: reviewer() }, /has no reviewer decision/);
  });

  it('rejects a Reviewer decision on a Unit that is not a flagged Defect', () => {
    rejects({ author: author(unit()), reviewer: reviewer([], [confirmed]) }, /not a flagged-defect/);
  });

  it('drops the whole file of a test with a blocking Finding, and marks its Units review-rejected', () => {
    const finding: Finding = { test: TEST, severity: 'blocking', reason: 'tautology', note: 'cannot fail' };
    const outcome = check({ author: author(unit()), reviewer: reviewer([finding]) });
    assert.equal(outcome.code, 0);
    assert.deepEqual(outcome.checked.dropFiles, ['backend/tests/todos.test.ts']);
    assert.deepEqual(outcome.checked.reviewRejected, ['backend/src/todos.ts#countOpen']);
  });

  it('keeps the file of a test with an advisory Finding', () => {
    const finding: Finding = { test: TEST, severity: 'advisory', reason: 'tautology', note: '' };
    assert.deepEqual(check({ author: author(unit()), reviewer: reviewer([finding]) }).checked.dropFiles, []);
  });

  it('drops a new file that still holds a flagged Defect failing test', () => {
    const patch = addedFile('backend/tests/stats.test.ts', ["it('due today is not overdue', () => {})"]);
    const outcome = check({ author: author(flagged()), reviewer: reviewer([], [confirmed]), patch });
    assert.equal(outcome.code, 0);
    assert.deepEqual(outcome.checked.dropFiles, ['backend/tests/stats.test.ts']);
  });

  it('rejects a flagged Defect failing test left in an existing file', () => {
    const patch = addedFile('backend/tests/stats.test.ts', ["it('due today is not overdue', () => {})"], false);
    rejects({ author: author(flagged()), reviewer: reviewer([], [confirmed]), patch }, /still in an existing test file/);
  });

  it('accepts a flagged Defect whose failing test the Author removed', () => {
    const patch = addedFile('backend/tests/stats.test.ts', ["it('counts open todos', () => {})"], false);
    const outcome = check({ author: author(flagged()), reviewer: reviewer([], [confirmed]), patch });
    assert.equal(outcome.code, 0);
    assert.deepEqual(outcome.checked.dropFiles, []);
  });

  it('writes checked.json even when the author file cannot be read', () => {
    const dir = tempDir();
    const result = runScript('workflow/agent-output.ts', [join(dir, 'missing.json'), '--max-attempts', '3', '--out', join(dir, 'checked.json')]);
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(readFileSync(join(dir, 'checked.json'), 'utf8')).ok, false);
  });

  it('exits 64 without an attempt budget', () => {
    assert.equal(runScript('workflow/agent-output.ts', ['author.json']).code, 64);
  });
});
