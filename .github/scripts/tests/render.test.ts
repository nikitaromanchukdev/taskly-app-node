// render.ts writes the PR comments in one format. When an agent did not run, its comment says why and links the ADR behind that reason.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { unitKey } from '../lib/artifacts.ts';
import type { Candidate, Context, Results, Run, Scope, Skipped, Unit, Verdict } from '../lib/artifacts.ts';
import { RENDERERS } from '../workflow/render.ts';
import type { CommentName } from '../workflow/render.ts';
import type { Status } from '../workflow/status.ts';

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
  jobs: { scope: 'success', agents: 'skipped', bot_commit: 'skipped', suites: 'success' },
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

  it('links no ADR when the scope job failed, since a crash is not a decision', () => {
    const run: Run = { context: context({ jobs: { scope: 'failure', agents: 'skipped', bot_commit: 'skipped', suites: 'skipped' } }) };
    for (const comment of ['author', 'reviewer'] as const) assert.equal(note(comment, run), `${AGENT[comment]} not run on \`abcdef1\`: scope job failed.`);
  });

  it('links no ADR when the agent step failed', () => {
    const run: Run = { context: context({ run_agent: true, jobs: { scope: 'success', agents: 'failure', bot_commit: 'skipped', suites: 'success' } }), scope: scope([candidate]) };
    assert.equal(note('author', run), 'Author not run on `abcdef1`: the agent step failed or timed out.');
  });
});

// ---- One format for every comment ----

const unit = (name: string, verdict: Verdict, extra: Partial<Unit> = {}): Unit => ({
  path: `backend/src/${name}.ts`,
  unit: name,
  verdict,
  expectations: [],
  attempts: 1,
  ...extra,
});
const tested = (name: string) =>
  unit(name, 'added', { expectations: [{ text: 'works', source: 'PR body', kind: 'intent', tests: [`backend/tests/${name}.test.ts > works`] }] });
const flagged = unit('broken', 'flagged-defect', { defect: { test: 't', expected: '1', received: '2', source: 'PR body' } });

const results: Results = {
  typecheck: { backend: 'pass', frontend: 'fail' },
  tests: { backend: { status: 'pass', passed: 3, failed: 0 } },
  flaky: [],
  coverage: { baseline: {}, final: {} },
  mutation: { backend: null },
};

// Both agents ran: one tested Unit, one review-rejected, one not needed, one flagged Defect the Reviewer confirmed.
const agentRun = (summaries: { author?: string; reviewer?: string } = {}): Run => ({
  context: context({ run_agent: true, jobs: { scope: 'success', agents: 'success', bot_commit: 'success', suites: 'success' } }),
  scope: scope([candidate], [{ path: 'README.md', reason: 'docs' }]),
  author: {
    summary: summaries.author ?? 'I tested 9 Units.',
    units: [tested('kept'), tested('dropped'), unit('plain', 'not-needed', { reason: 'trivial' }), flagged],
  },
  reviewer: {
    summary: summaries.reviewer ?? 'All good.',
    defects: [{ path: flagged.path, unit: flagged.unit, decision: 'confirmed', source_quote: 'one' }],
    findings: [
      { test: 'backend/tests/dropped.test.ts > works', severity: 'blocking', reason: 'tautology', note: 'cannot fail' },
      { test: 'backend/tests/kept.test.ts > works', severity: 'advisory', reason: 'weak-assertion', note: 'loose' },
    ],
  },
  checked: { ok: true, errors: [], dropFiles: [], reviewRejected: [unitKey(tested('dropped'))], missingDefectTests: [], unknownNames: { author: [], reviewer: [] } },
  results,
  proof: [{ path: flagged.path, unit: flagged.unit, state: 'proven', reason: '' }],
});

const FAILED: Status = { state: 'failure', description: '1 proven defect' };
const render = (name: CommentName, run: Run, status: Status = FAILED) => RENDERERS[name]({ run, status, repo: REPO });
const titleOf = (name: CommentName, run: Run, status?: Status) => render(name, run, status).split('\n')[1];
// Where a part starts in a comment, to check the order of parts.
const at = (body: string, part: string) => {
  const index = body.indexOf(part);
  assert.ok(index >= 0, `missing ${part}`);
  return index;
};

describe('one format for every comment', () => {
  for (const name of ['report', 'author', 'reviewer'] as const) {
    it(`the ${name} comment keeps its marker, then has a "### {name} · {outcome}" title and the meta line`, () => {
      const [first, title, meta] = render(name, agentRun()).split('\n');
      assert.equal(first, `<!-- pr-test-engineer:${name} -->`);
      assert.match(title, /^### .+ · .+$/);
      assert.ok(meta.startsWith('Analyzed `abcdef1` · '), meta);
    });
  }

  it('the Report title names the comment after the status emoji and keeps the status description word for word', () => {
    assert.equal(titleOf('report', agentRun()), '### 🔴 Report · 1 proven defect');
    assert.equal(titleOf('report', agentRun(), { state: 'success', description: 'no agent run; suites pass' }), '### 🟢 Report · no agent run; suites pass');
  });

  it('the Test author title counts the Units in the structured output, not what the summary says', () => {
    assert.equal(titleOf('author', agentRun()), '### Test author · 1 Unit tested, 1 not needed, 1 review-rejected, 1 Defect flagged');
    assert.equal(titleOf('author', { ...agentRun(), author: { summary: '', units: [] } }), '### Test author · 0 Units tested');
  });

  it('the Test reviewer title counts Defect decisions and Findings', () => {
    assert.equal(titleOf('reviewer', agentRun()), '### Test reviewer · 1 Defect confirmed, 0 rejected, 2 Findings (1 blocking)');
    const empty: Run = { ...agentRun(), reviewer: { summary: '', defects: [], findings: [] } };
    assert.equal(titleOf('reviewer', empty), '### Test reviewer · 0 Defects confirmed, 0 rejected, 0 Findings');
  });

  it('an agent that did not run has "not run" as its outcome', () => {
    const run: Run = { context: context({ same_repo: false }) };
    assert.equal(titleOf('author', run), '### Test author · not run');
    assert.equal(titleOf('reviewer', run), '### Test reviewer · not run');
  });

  const FREE_TEXT: readonly { name: 'author' | 'reviewer'; who: string; table: string }[] = [
    { name: 'author', who: 'Author', table: '| Unit |' },
    { name: 'reviewer', who: 'Reviewer', table: '#### Findings' },
  ];
  for (const { name, who, table } of FREE_TEXT) {
    it(`the ${who}'s free text comes last, collapsed, and is still sanitized`, () => {
      const body = render(name, agentRun({ [name]: 'Ping @someone <img src=x onerror=alert(1)>' }));
      const notes = at(body, `<details><summary>${who}'s notes (free text, not checked)</summary>`);
      assert.ok(at(body, table) < notes, 'free text comes before the tables');
      assert.ok(body.endsWith('</details>'), 'free text is not the last section');
      assert.ok(body.includes('@​someone') && !body.includes('<img'), 'free text is not sanitized');
    });

    it(`the ${who} comment has no notes section when the free text is empty`, () => {
      assert.ok(!render(name, agentRun({ [name]: '  ' })).includes('notes (free text'));
    });
  }

  it('the Report puts Defects first, then the tables, then the collapsed sections', () => {
    const body = render('report', agentRun());
    const parts = ['#### Defects', '#### Test results', '#### Coverage of changed files', '<details><summary>Skipped files (1)</summary>', '<details><summary>Mutation'];
    const positions = parts.map((part) => at(body, part));
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  });

  it('the Report says per Defect whether it is proven, and warns for a confirmed Defect that is not', () => {
    const proofOf = (state: 'proven' | 'unproven', reason: string): Run => ({ ...agentRun(), proof: [{ path: flagged.path, unit: flagged.unit, state, reason }] });
    const proven = render('report', proofOf('proven', ''));
    assert.ok(proven.includes('- 🔴 confirmed ·') && proven.includes('  - proof: proven\n'), proven);
    const unproven = render('report', proofOf('unproven', 'the test passed'));
    assert.ok(unproven.includes('- ⚠️ confirmed, not proven (warning) ·') && unproven.includes('  - proof: unproven (the test passed)'), unproven);
    assert.ok(render('report', { ...agentRun(), proof: undefined }).includes('proof: unproven (no proof of the Defect test)'));
  });

  it('the Report says a confirmed Defect has no test because the Author removed it, and labels it red', () => {
    const checked = { ...agentRun().checked!, missingDefectTests: [unitKey(flagged)] };
    const body = render('report', { ...agentRun(), proof: undefined, checked });
    assert.ok(body.includes('- 🔴 confirmed ·'), body);
    assert.ok(body.includes('  - proof: no test: the Author removed the Defect test instead of moving it to a file of its own'), body);
    assert.ok(!body.includes('not proven'), body);
  });

  it('the Report shows its Defects section once the Author ran, even with none flagged, and leaves it out before', () => {
    const clean: Run = { ...agentRun(), author: { summary: '', units: [tested('kept')] } };
    assert.ok(render('report', clean).includes('#### Defects\nNo Defects flagged.'));
    assert.ok(!render('report', { context: context(), results }).includes('#### Defects'));
  });

  it('check results carry 🟢 for pass and 🔴 for fail', () => {
    const body = render('report', agentRun());
    assert.ok(body.includes('| backend typecheck | 🟢 pass |'), body);
    assert.ok(body.includes('| frontend typecheck | 🔴 fail |'), body);
    assert.ok(body.includes('| backend tests | 🟢 pass (3 passed, 0 failed) |'), body);
  });

  it('the Report names each flaky test file with its failing tests, and shows none when nothing is flaky', () => {
    const flaky = [{ file: 'backend/tests/a.test.ts', tests: ['x > one', 'x > two'], failedReruns: 2, reruns: 3 }];
    const body = render('report', { ...agentRun(), results: { ...results, flaky } });
    assert.ok(body.includes('| flaky `backend/tests/a.test.ts` | 🔴 fail: failed in 2 of 3 shuffled reruns (x > one; x > two) |'), body);
    assert.ok(!render('report', agentRun()).includes('flaky'));
  });

  it('names a Unit as `path` name in all three comments, and labels a confirmed Defect the same in the Report and the Test reviewer comment', () => {
    const name = '`backend/src/broken.ts` broken';
    assert.ok(render('report', agentRun()).includes(`- 🔴 confirmed · ${name}`));
    assert.ok(render('reviewer', agentRun()).includes(`| ${name} | 🔴 confirmed | one |`));
    assert.ok(render('author', agentRun()).includes(`- ${name}: expected 1, received 2 (PR body)`));
  });

  it('marks a blocking Finding with ⚠️ and says its test file left the Bot commit', () => {
    assert.ok(render('reviewer', agentRun()).includes('| ⚠️ blocking | tautology | cannot fail (test file dropped from the Bot commit) |'));
  });
});

describe('agent comments when a summary names something the run does not contain', () => {
  const ran = (unknownNames: { author: string[]; reviewer: string[] }): Run => ({
    context: context({ run_agent: true, jobs: { scope: 'success', agents: 'success', bot_commit: 'success', suites: 'success' } }),
    scope: scope([candidate]),
    author: { summary: 'Tested `TodoStore.stats()`.', units: [] },
    reviewer: { summary: 'Reviewed `TodoStore.stats()`.', findings: [], defects: [] },
    checked: { ok: true, errors: [], dropFiles: [], reviewRejected: [], missingDefectTests: [], unknownNames },
  });
  const comment = (name: CommentName, run: Run) => RENDERERS[name]({ run, status: { state: 'success', description: '' }, repo: REPO });
  const WARNING = /⚠️ The (Author|Reviewer)'s notes name `TodoStore\.stats\(\)`, which no Unit, test or file of this run contains/;

  for (const agent of ['author', 'reviewer'] as const) {
    it(`the ${agent} comment warns about the unknown name`, () => {
      const names = { author: [], reviewer: [], [agent]: ['TodoStore.stats()'] };
      assert.match(comment(agent, ran(names)), WARNING);
    });
  }

  it('adds no warning when every name is known', () => {
    const run = ran({ author: [], reviewer: [] });
    for (const agent of ['author', 'reviewer'] as const) assert.doesNotMatch(comment(agent, run), /notes name/);
  });
});
