// render.ts writes the PR comments. When an agent did not run, its comment says why and links the ADR behind that reason.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Candidate, Context, Run, Scope, Skipped } from '../artifacts.ts';
import { RENDERERS } from '../render.ts';
import type { CommentName } from '../render.ts';

const REPO = 'owner/repo';
const adr = (file: string) => `See [ADR ${file.slice(0, 4)}](https://github.com/${REPO}/blob/main/docs/adr/${file}).`;
const SCOPE_ADR = adr('0002-test-changed-units-and-write-only-tests.md');
const FORKS_ADR = adr('0004-isolate-pr-code-from-secrets.md');
const LABEL_ADR = adr('0005-gate-merges-on-test-agent-verify.md');
const BACKFILL_ADR = adr('0008-run-the-backfill-locally-and-report-it-in-the-pr-description.md');

const context = (overrides: Partial<Context> = {}): Context => ({
  pr: 1,
  analyzed_sha: 'abcdef1234',
  final_sha: 'abcdef1234',
  run_url: 'https://example.invalid/run',
  same_repo: true,
  label_skip: false,
  label_actor: '',
  run_agent: false,
  jobs: { prepare: 'success', engineer: 'skipped', commit: 'skipped', verify: 'success' },
  ...overrides,
});

const candidate: Candidate = { path: 'backend/src/todos.ts', package: 'backend', status: 'modified', hunks: [] };
const scope = (candidates: Candidate[], skipped: Skipped[] = []): Scope => ({
  base: 'a',
  head: 'b',
  budgets: { model: 'm', reviewerModel: 'm', maxTurns: 1, timeoutMinutes: 1, maxAttempts: 1 },
  candidates,
  skipped,
});

const AGENT: Record<'author' | 'reviewer', string> = { author: 'Author', reviewer: 'Reviewer' };

// The last line of a comment, which holds the not-run note.
const note = (name: CommentName, run: Run) =>
  RENDERERS[name]({ run, status: { state: 'success', description: '' }, repo: REPO }).split('\n').at(-1) ?? '';

const notRunCases: readonly { name: string; run: Run; why: string; link: string }[] = [
  {
    name: 'a PR with no testable changes, such as one that changes only workflow scripts and their tests',
    run: { context: context(), scope: scope([], [{ path: '.github/scripts/tests/guard.test.ts', reason: 'config' }]) },
    why: 'no testable changes.',
    link: SCOPE_ADR,
  },
  {
    name: 'a PR that changes only tests and config, such as a Backfill PR',
    run: { context: context(), scope: scope([], [{ path: 'backend/tests/todos.test.ts', reason: 'tests' }, { path: 'backend/vitest.config.ts', reason: 'config' }]) },
    why: 'this PR changes only tests and config',
    link: BACKFILL_ADR,
  },
  {
    name: 'a PR skipped by label',
    run: { context: context({ label_skip: true, label_actor: 'owner' }), scope: scope([candidate]) },
    why: 'skipped by label',
    link: LABEL_ADR,
  },
  {
    name: 'a fork PR',
    run: { context: context({ same_repo: false }) },
    why: 'fork pull request.',
    link: FORKS_ADR,
  },
];

describe('agent comments when the agents did not run', () => {
  for (const { name, run, why, link } of notRunCases) {
    for (const comment of ['author', 'reviewer'] as const) {
      it(`the ${comment} comment of ${name} says why and links its ADR`, () => {
        const line = note(comment, run);
        assert.ok(line.startsWith(`${AGENT[comment]} not run on \`abcdef1\`: `), line);
        assert.ok(line.includes(why), line);
        assert.ok(line.endsWith(link), line);
      });
    }
  }

  it('the reviewer comment links the Scope ADR when the Author produced nothing to review', () => {
    const run: Run = { context: context({ run_agent: true }), scope: scope([candidate]), author: { summary: '', units: [] } };
    assert.equal(note('reviewer', run), `Reviewer not run on \`abcdef1\`: the author produced no tests or defects to review. ${SCOPE_ADR}`);
  });

  it('links no ADR when prepare failed, since a crash is not a decision', () => {
    const run: Run = { context: context({ jobs: { prepare: 'failure', engineer: 'skipped', commit: 'skipped', verify: 'skipped' } }) };
    for (const comment of ['author', 'reviewer'] as const) assert.equal(note(comment, run), `${AGENT[comment]} not run on \`abcdef1\`: prepare failed.`);
  });

  it('links no ADR when the agent step failed', () => {
    const run: Run = { context: context({ run_agent: true, jobs: { prepare: 'success', engineer: 'failure', commit: 'skipped', verify: 'success' } }), scope: scope([candidate]) };
    assert.equal(note('author', run), 'Author not run on `abcdef1`: the agent step failed or timed out.');
  });
});
