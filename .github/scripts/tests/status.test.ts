// status.ts decides test-agent/verify, the merge gate (ADR 0005).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AuthorOutput, Context, DefectDecision, Results, ReviewerOutput, Run, Unit } from '../lib/artifacts.ts';
import { decide } from '../workflow/status.ts';

const context = (overrides: Partial<Context> = {}): Context => ({
  pr: 1,
  analyzed_sha: 'a',
  final_sha: 'b',
  run_url: 'https://example.invalid/run',
  same_repo: true,
  label_skip: false,
  label_actor: '',
  run_agent: true,
  jobs: { scope: 'success', agents: 'success', bot_commit: 'success', suites: 'success' },
  ...overrides,
});

const results = (overrides: Partial<Results> = {}): Results => ({
  typecheck: { backend: 'pass', frontend: 'pass' },
  tests: { backend: { status: 'pass', passed: 3, failed: 0 }, frontend: { status: 'pass', passed: 2, failed: 0 } },
  coverage: { baseline: {}, final: {} },
  mutation: {},
  ...overrides,
});

const added = (unit: string, test = `backend/tests/${unit}.test.ts > works`): Unit => ({
  path: `backend/src/${unit}.ts`,
  unit,
  verdict: 'added',
  expectations: [{ text: 'works', source: 'PR body', kind: 'intent', tests: [test] }],
  attempts: 0,
});

const flagged: Unit = {
  path: 'backend/src/stats.ts',
  unit: 'stats',
  verdict: 'flagged-defect',
  expectations: [],
  attempts: 1,
  defect: { test: 'backend/tests/stats.test.ts > due today is not overdue', expected: '0', received: '1', source: 'PR body' },
};

const author = (...units: Unit[]): AuthorOutput => ({ summary: '', units });
const reviewer = (decision?: DefectDecision): ReviewerOutput => ({
  summary: '',
  findings: [],
  defects: decision ? [{ path: flagged.path, unit: flagged.unit, decision, source_quote: 'due today is not overdue' }] : [],
});

// A PR run where every job succeeded and the Author tested one Unit.
const run = (overrides: Partial<Run> = {}): Run => ({
  context: context(),
  author: author(added('todos')),
  reviewer: reviewer(),
  checked: { ok: true, errors: [], dropFiles: [], reviewRejected: [], unknownNames: { author: [], reviewer: [] } },
  results: results(),
  ...overrides,
});

describe('decide', () => {
  it('is green when every job succeeded and no Defect was confirmed', () => {
    assert.deepEqual(decide(run()), { state: 'success', description: '1 unit tested, 0 confirmed defects' });
  });

  it('is red for a Defect the Reviewer confirmed', () => {
    const status = decide(run({ author: author(added('todos'), flagged), reviewer: reviewer('confirmed') }));
    assert.deepEqual(status, { state: 'failure', description: '1 confirmed defect' });
  });

  it('stays green for a Defect the Reviewer rejected', () => {
    const status = decide(run({ author: author(added('todos'), flagged), reviewer: reviewer('rejected') }));
    assert.deepEqual(status, { state: 'success', description: '1 unit tested, 0 confirmed defects' });
  });

  it('does not count a Unit whose tests the Reviewer blocked', () => {
    const checked = { ok: true, errors: [], dropFiles: ['backend/tests/todos.test.ts'], reviewRejected: ['backend/src/todos.ts#todos'], unknownNames: { author: [], reviewer: [] } };
    assert.equal(decide(run({ checked })).description, '0 units tested, 0 confirmed defects');
  });

  it('is green with no agent run when the suites pass', () => {
    const skipped = context({ run_agent: false, jobs: { scope: 'success', agents: 'skipped', bot_commit: 'skipped', suites: 'success' } });
    assert.deepEqual(decide({ context: skipped, results: results() }), { state: 'success', description: 'no agent run; suites pass' });
  });

  it('is red when the scope job failed', () => {
    const failed = context({ run_agent: false, jobs: { scope: 'failure', agents: 'skipped', bot_commit: 'skipped', suites: 'skipped' } });
    assert.equal(decide({ context: failed }).state, 'failure');
    assert.match(decide({ context: failed }).description, /^scope job failed/);
  });

  for (const [job, reason] of [['agents', 'author or reviewer did not finish'], ['bot_commit', 'Bot commit job failed']] as const) {
    it(`is red when the ${job} job failed`, () => {
      const jobs = { ...context().jobs, [job]: 'failure' };
      assert.deepEqual(decide(run({ context: context({ jobs }) })), { state: 'failure', description: reason });
    });
  }

  it('is red when the agent output is missing', () => {
    assert.deepEqual(decide(run({ author: undefined })), { state: 'failure', description: 'agent output missing' });
  });

  it('is red when the agent output was invalid or the patch was rejected', () => {
    const checked = { ok: false, errors: ['patch rejected'], dropFiles: [], reviewRejected: [], unknownNames: { author: [], reviewer: [] } };
    assert.deepEqual(decide(run({ checked })), { state: 'failure', description: 'agent output invalid or patch rejected' });
  });

  it('is red and names each failed check', () => {
    const failing = results({
      typecheck: { backend: 'fail', frontend: 'pass' },
      tests: { backend: { status: 'pass', passed: 1, failed: 0 }, frontend: { status: 'fail', passed: 0, failed: 2 } },
    });
    assert.deepEqual(decide(run({ results: failing })), { state: 'failure', description: 'backend typecheck, frontend tests failed' });
  });

  it('is red when suites did not finish', () => {
    assert.deepEqual(decide(run({ results: undefined })), { state: 'failure', description: 'suites did not finish' });
  });

  it('lists every reason, the agent first', () => {
    const status = decide(run({ author: undefined, results: undefined }));
    assert.equal(status.description, 'agent output missing; suites did not finish');
  });

  it('names who skipped the agents by label, and the suites still decide', () => {
    const labelled = context({ run_agent: false, label_skip: true, label_actor: 'owner' });
    assert.deepEqual(decide({ context: labelled, results: results() }), { state: 'success', description: 'skipped by label (@owner); no agent run; suites pass' });
    const failing = results({ typecheck: { backend: 'fail', frontend: 'pass' } });
    assert.equal(decide({ context: labelled, results: failing }).state, 'failure');
  });

  it('cuts the description to GitHub limit of 140 characters', () => {
    const labelled = context({ label_skip: true, label_actor: 'a'.repeat(200) });
    assert.equal(decide(run({ context: labelled })).description.length, 140);
  });
});
