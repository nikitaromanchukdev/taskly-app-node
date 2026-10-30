// trial.ts runs the local trial's bookkeeping: per-branch output, the intended behaviour, cleanup, and the demo's verdict.
// Every test runs it without a terminal, so it takes the non-interactive path.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { AuthorOutput, Checked, ReviewerOutput } from '../lib/artifacts.ts';
import { readSchema, validate } from '../lib/schema.ts';
import { runScript, tempDir } from './run.ts';

const BRANCH = 'feat/issue-1-truncate';
const FOLDER = '.test-agent/feat-issue-1-truncate';

// A repo with one commit on main and one on BRANCH, whose message has a body.
function repo(): string {
  const root = tempDir();
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@localhost', ...args], { cwd: root, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'init');
  git('switch', '-q', '-c', BRANCH);
  git('commit', '-q', '--allow-empty', '-m', 'feat(backend): add truncate', '-m', 'Text of exactly max characters is not shortened.');
  return root;
}

const trial = (root: string, ...args: string[]) => runScript('local/trial.ts', args, { cwd: root });
const file = (root: string, path: string, content: string) => {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), content);
};
// JSON, or text with json false; undefined when the script did not write the file.
const readIfExists = (path: string, json = true) =>
  existsSync(path) ? (json ? JSON.parse(readFileSync(path, 'utf8')) : readFileSync(path, 'utf8')) : undefined;

const DECISIONS = 'docs/backfill-decisions.json';
// A source file's content, and its blob id as git itself computes it, so the test does not share the script's hashing.
const source = (unit: string) => `export const ${unit} = 1;\n`;
const gitBlob = (content: string) => execFileSync('git', ['hash-object', '--stdin'], { input: content, encoding: 'utf8' }).trim();

describe('trial.ts dir', () => {
  it('names the output folder after the branch, with / turned into -', () => {
    assert.equal(trial(repo(), 'dir').stdout.trim(), FOLDER);
  });

  it('names a detached HEAD after its short SHA', () => {
    const root = repo();
    execFileSync('git', ['switch', '-q', '--detach'], { cwd: root });
    assert.match(trial(root, 'dir').stdout.trim(), /^\.test-agent\/detached-[0-9a-f]{7,}$/);
  });
});

describe('trial.ts intent', () => {
  it('creates the output folder and takes the commit messages when there is no open PR', () => {
    const root = repo();
    const result = trial(root, 'intent', '--out', FOLDER, '--base', 'main');
    assert.equal(result.code, 0);
    assert.match(readFileSync(join(root, FOLDER, 'pr-body.md'), 'utf8'), /Text of exactly max characters is not shortened\./);
    assert.match(result.stdout, /intent \(first line\): feat\(backend\): add truncate/);
  });

  it('reuses the branch intent and never overwrites it', () => {
    const root = repo();
    file(root, `${FOLDER}/pr-body.md`, '## Written by hand\n');
    const result = trial(root, 'intent', '--out', FOLDER, '--base', 'main');
    assert.equal(readFileSync(join(root, FOLDER, 'pr-body.md'), 'utf8'), '## Written by hand\n');
    assert.doesNotMatch(result.stdout, /intent saved/);
    assert.match(result.stdout, /intent \(first line\): ## Written by hand/);
  });

  it('runs without intent and warns when no source is found', () => {
    const root = repo();
    const result = trial(root, 'intent', '--out', FOLDER, '--base', BRANCH);
    assert.equal(result.code, 0);
    assert.equal(readFileSync(join(root, FOLDER, 'pr-body.md'), 'utf8'), '');
    assert.match(result.stdout, /no intent given\. Defects can only come from openapi\.json/);
  });

  it('exits 64 without an output folder', () => {
    assert.equal(trial(repo(), 'intent').code, 64);
  });
});

describe('trial.ts clean', () => {
  it("cleans the current branch's folder and keeps the person's input", () => {
    const root = repo();
    file(root, `${FOLDER}/pr-body.md`, 'intent');
    file(root, `${FOLDER}/author.json`, '{}');
    file(root, `${FOLDER}/round1/reviewer.json`, '{}');
    file(root, `${FOLDER}/approved.json`, '{}');
    file(root, `${FOLDER}/declined.json`, '[]');
    const result = trial(root, 'clean');
    assert.equal(result.code, 0);
    assert.doesNotMatch(result.stdout, /no output for this branch/);
    assert.ok(existsSync(join(root, FOLDER, 'pr-body.md')));
    assert.ok(existsSync(join(root, FOLDER, 'approved.json')));
    assert.ok(existsSync(join(root, FOLDER, 'declined.json')));
    assert.ok(!existsSync(join(root, FOLDER, 'author.json')));
    assert.ok(!existsSync(join(root, FOLDER, 'round1')));
  });

  it('lists the existing folders and deletes nothing when the branch has none', () => {
    const root = repo();
    file(root, '.test-agent/other-branch/author.json', '{}');
    const result = trial(root, 'clean');
    assert.equal(result.code, 0);
    assert.match(result.stdout, /no output for this branch[\s\S]*1\) other-branch/);
    assert.ok(existsSync(join(root, '.test-agent/other-branch/author.json')));
  });

  it('cleans the folder named with --out instead of the current branch', () => {
    const root = repo();
    file(root, '.test-agent/other-branch/pr-body.md', 'intent');
    file(root, '.test-agent/other-branch/author.json', '{}');
    assert.equal(trial(root, 'clean', '--out', '.test-agent/other-branch').code, 0);
    assert.ok(existsSync(join(root, '.test-agent/other-branch/pr-body.md')));
    assert.ok(!existsSync(join(root, '.test-agent/other-branch/author.json')));
  });

  it('says so when there is nothing to clean', () => {
    assert.match(trial(repo(), 'clean').stdout, /nothing to clean/);
  });
});

describe('trial.ts check', () => {
  const unit = { path: 'backend/src/core/truncate.ts', unit: 'truncate' };
  const expected = { units: [{ ...unit, verdict: 'flagged-defect' }], defects: [{ ...unit, decision: 'confirmed' }] };
  const author = (verdict: string): AuthorOutput => ({ summary: '', units: [{ ...unit, verdict, expectations: [], attempts: 1 } as never] });
  const reviewer = (decision: string): ReviewerOutput => ({ summary: '', findings: [], defects: [{ ...unit, decision, source_quote: 'q' } as never] });
  const okCheck: Checked = { ok: true, errors: [], dropFiles: [], reviewRejected: [], missingDefectTests: [], unknownNames: { author: [], reviewer: [] } };

  // Writes a run's output and the expected outcome, then checks one against the other.
  function check(run: { author?: AuthorOutput; reviewer?: ReviewerOutput; checked?: Checked }, outcome: object = expected) {
    const dir = tempDir();
    writeFileSync(join(dir, 'expected.json'), JSON.stringify(outcome));
    for (const [name, value] of Object.entries(run)) writeFileSync(join(dir, `${name}.json`), JSON.stringify(value));
    return runScript('local/trial.ts', ['check', '--out', dir, '--expected', join(dir, 'expected.json')]);
  }

  it('passes when the Verdict and the Reviewer decision match', () => {
    const result = check({ author: author('flagged-defect'), reviewer: reviewer('confirmed'), checked: okCheck });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /demo PASS/);
  });

  it('fails and names each mismatch when the Defect is missed and rejected', () => {
    const result = check({ author: author('added'), reviewer: reviewer('rejected'), checked: okCheck });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /demo FAIL/);
    assert.match(result.stderr, /truncate: Verdict added, expected flagged-defect/);
    assert.match(result.stderr, /truncate: Reviewer rejected, expected confirmed/);
  });

  it('fails when the agent output check failed', () => {
    const result = check({ author: author('flagged-defect'), reviewer: reviewer('confirmed'), checked: { ...okCheck, ok: false, errors: ['patch rejected'] } });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /agent output check: patch rejected/);
  });

  it('fails when the Author removed the Defect test instead of keeping it', () => {
    const result = check({ author: author('flagged-defect'), reviewer: reviewer('confirmed'), checked: { ...okCheck, missingDefectTests: ['backend/src/core/truncate.ts#truncate'] } });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /truncate\.ts#truncate: the Defect test is in no file of the patch/);
  });

  // A review-only case: the Reviewer must block the tautology, and only its file is dropped.
  const TAUTOLOGY = 'backend/tests/truncate.limits.test.ts > keeps short text';
  const blocking = { test: TAUTOLOGY, severity: 'blocking', reason: 'tautology' };
  const tautologyCase = { findings: [blocking], dropFiles: ['backend/tests/truncate.limits.test.ts'] };
  const reviewed = (findings: object[]): ReviewerOutput => ({ summary: '', findings: findings as never, defects: [] });
  const dropping = (dropFiles: string[]): Checked => ({ ...okCheck, dropFiles });

  it('passes when the expected Finding is there and exactly its file is dropped', () => {
    const result = check({ reviewer: reviewed([{ ...blocking, note: 'cannot fail' }]), checked: dropping(tautologyCase.dropFiles) }, tautologyCase);
    assert.equal(result.code, 0);
  });

  it('fails when the Finding is only advisory', () => {
    const result = check({ reviewer: reviewed([{ ...blocking, severity: 'advisory', note: '' }]), checked: dropping([]) }, tautologyCase);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /keeps short text: no blocking tautology Finding/);
    assert.match(result.stderr, /dropped files: none, expected backend\/tests\/truncate\.limits\.test\.ts/);
  });

  it('fails when a good file is dropped too', () => {
    const files = ['backend/tests/truncate.limits.test.ts', 'backend/tests/truncate.test.ts'];
    const result = check({ reviewer: reviewed([{ ...blocking, note: '' }]), checked: dropping(files) }, tautologyCase);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /dropped files: backend\/tests\/truncate\.limits\.test\.ts, backend\/tests\/truncate\.test\.ts/);
  });

  it('fails when the run left no output', () => {
    const result = check({});
    assert.equal(result.code, 1);
    assert.match(result.stderr, /checked\.json missing[\s\S]*Verdict missing[\s\S]*no decision/);
  });
});

describe('trial.ts approve', () => {
  const recommendation = (unit: string) => ({
    path: `frontend/src/${unit}.ts`,
    unit,
    lines: '50',
    branches: '25',
    uncovered: '3, 5-6',
    expectations: [{ text: `when ${unit} fails, then it shows an error`, source: 'README', kind: 'intent' }],
  });
  const gaps = {
    summary: 'Three gaps.',
    recommendations: [recommendation('useA'), recommendation('useB'), recommendation('useC')],
    unreachable: [{ path: 'frontend/src/main.tsx', unit: 'root', uncovered: '1-4', reason: 'runs on import' }],
    out_of_scope: [{ path: 'frontend/src/types.ts', reason: 'type-only' }],
  };

  // Writes gaps.json, the sources it names and the record of decisions into one folder, which is both the
  // output folder and the repo root, and runs approve there without a terminal.
  function approve(items: string | undefined, content: unknown = gaps, setup: { decisions?: object[]; args?: string[] } = {}) {
    const dir = tempDir();
    writeFileSync(join(dir, 'gaps.json'), JSON.stringify(content));
    for (const name of ['useA.ts', 'useB.ts', 'useC.ts', 'main.tsx']) file(dir, `frontend/src/${name}`, source(name.split('.')[0]));
    if (setup.decisions) file(dir, DECISIONS, JSON.stringify({ decisions: setup.decisions }));
    const args = ['approve', '--out', dir, '--package', 'frontend', ...(items === undefined ? [] : ['--items', items]), ...(setup.args ?? [])];
    const result = runScript('local/trial.ts', args, { cwd: dir });
    const approved = readIfExists(join(dir, 'approved.json'));
    const declined = readIfExists(join(dir, 'declined.json'));
    return { ...result, dir, approved, declined, markdown: readIfExists(join(dir, 'gaps.md'), false) };
  }

  it('renders gaps.md with numbered Recommendations and the other two lists', () => {
    const { dir } = approve('all');
    const markdown = readFileSync(join(dir, 'gaps.md'), 'utf8');
    assert.match(markdown, /## Recommendations\n1\. `frontend\/src\/useA\.ts` useA — lines 50%, branches 25%; uncovered: 3, 5-6\n/);
    assert.match(markdown, /3\. `frontend\/src\/useC\.ts` useC/);
    assert.match(markdown, /## Unreachable\n- `frontend\/src\/main\.tsx` root — runs on import \(uncovered: 1-4\)/);
    assert.match(markdown, /## Out of scope\n- `frontend\/src\/types\.ts` — type-only/);
  });

  it('keeps only the picked Recommendations, plus every Unreachable and out-of-scope item', () => {
    const { code, approved, stdout } = approve('3,1');
    assert.equal(code, 0);
    assert.deepEqual(approved.recommendations.map((item: { unit: string }) => item.unit), ['useC', 'useA']);
    assert.deepEqual(approved.unreachable, gaps.unreachable);
    assert.deepEqual(approved.out_of_scope, gaps.out_of_scope);
    assert.match(stdout, /approved 2 of 3 Recommendations/);
  });

  for (const [items, count] of [['all', 3], ['none', 0], ['2,2', 1]] as const) {
    it(`approves ${count} Recommendations for "${items}"`, () => {
      assert.equal(approve(items).approved.recommendations.length, count);
    });
  }

  for (const items of ['4', '0', 'a', '']) {
    it(`rejects "${items}" with exit 64 and writes nothing`, () => {
      const { code, approved } = approve(items);
      assert.equal(code, 64);
      assert.equal(approved, undefined);
    });
  }

  it('only renders gaps.md and says how to approve when there is no terminal and no items', () => {
    const { code, stdout, approved, dir } = approve(undefined);
    assert.equal(code, 0);
    assert.ok(existsSync(join(dir, 'gaps.md')));
    assert.equal(approved, undefined);
    assert.match(stdout, /not approved yet[\s\S]*make backfill-approve/);
  });

  it('rejects a gap list that breaks the schema', () => {
    const { code, stderr, approved } = approve('all', { ...gaps, out_of_scope: [{ path: 'x.ts', reason: 'boring' }] });
    assert.equal(code, 1);
    assert.match(stderr, /gaps\.json is invalid[\s\S]*"boring" not one of/);
    assert.equal(approved, undefined);
  });

  it('exits 64 without a package', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'gaps.json'), JSON.stringify(gaps));
    assert.equal(runScript('local/trial.ts', ['approve', '--out', dir, '--items', 'all'], { cwd: dir }).code, 64);
  });

  // ---- gaps decided earlier ----

  const decided = (unit: string | undefined, path: string, blob: string) => ({
    package: 'frontend',
    path,
    ...(unit ? { unit } : {}),
    decision: 'declined',
    reason: `${unit ?? 'file'} is not worth testing`,
    pr: 25,
    blob,
  });
  const useB = decided('useB', 'frontend/src/useB.ts', gitBlob(source('useB')));

  it('leaves out a gap decided earlier, numbers the rest, and lists it with its PR', () => {
    const { code, markdown, approved, stdout } = approve('all', gaps, { decisions: [useB] });
    assert.equal(code, 0);
    assert.match(markdown, /## Recommendations\n1\. `frontend\/src\/useA\.ts` useA[\s\S]*\n2\. `frontend\/src\/useC\.ts` useC/);
    assert.doesNotMatch(markdown, /\d\. `frontend\/src\/useB\.ts`/);
    assert.match(markdown, /## Decided earlier\n[^\n]*\n\n- `frontend\/src\/useB\.ts` useB — declined in #25: useB is not worth testing/);
    assert.deepEqual(approved.recommendations.map((item: { unit: string }) => item.unit), ['useA', 'useC']);
    assert.match(stdout, /1 gaps decided earlier are left out/);
  });

  it('counts the lists above the Author\'s summary', () => {
    assert.match(approve('all').markdown, /# Coverage gaps\n\n\*\*3 Recommendations, 1 Unreachable, 1 out of scope, 0 decided earlier\.\*\*\n\nThree gaps\./);
  });

  it('counts the open lists once gaps decided earlier are left out', () => {
    const { markdown } = approve('all', gaps, { decisions: [useB] });
    assert.match(markdown, /\*\*2 Recommendations, 1 Unreachable, 1 out of scope, 1 decided earlier\.\*\*/);
  });

  it('says None under Decided earlier when nothing matches', () => {
    assert.match(approve('all').markdown, /## Decided earlier\nNone\./);
  });

  it('shows a gap again, with a note, when its file changed since the decision', () => {
    const { markdown, approved } = approve('all', gaps, { decisions: [{ ...useB, blob: gitBlob('older content\n') }] });
    assert.match(markdown, /2\. `frontend\/src\/useB\.ts` useB[\s\S]*- decided earlier \(declined in #25: useB is not worth testing\), but the file changed since: decide again/);
    assert.match(markdown, /## Decided earlier\nNone\./);
    assert.equal(approved.recommendations.length, 3);
  });

  it('takes a fresh decision over a stale one for the same gap', () => {
    const stale = { ...useB, lines: '1', blob: gitBlob('older content\n') };
    const { markdown } = approve('all', gaps, { decisions: [stale, useB] });
    assert.doesNotMatch(markdown, /\d\. `frontend\/src\/useB\.ts`/);
    assert.doesNotMatch(markdown, /file changed since/);
  });

  it('leaves out every Unit of a file decided without a Unit, Unreachable items too', () => {
    const { markdown, approved } = approve('all', gaps, { decisions: [{ ...decided(undefined, 'frontend/src/main.tsx', gitBlob(source('main'))), decision: 'unreachable' }] });
    assert.match(markdown, /## Unreachable\nNone\./);
    assert.match(markdown, /- `frontend\/src\/main\.tsx` root — unreachable in #25/);
    assert.deepEqual(approved.unreachable, []);
  });

  it('matches a gap named from the package folder, with a note after the Unit name', () => {
    const named = { ...gaps, recommendations: [{ ...recommendation('useB'), path: 'src/useB.ts', unit: '`useB` (error path)' }] };
    const { markdown } = approve('all', named, { decisions: [useB] });
    assert.match(markdown, /## Recommendations\nNone\./);
  });

  it('does not match another Unit of the same file', () => {
    const { markdown } = approve('all', gaps, { decisions: [{ ...useB, unit: 'useBee' }] });
    assert.match(markdown, /2\. `frontend\/src\/useB\.ts` useB/);
  });

  // ---- line-level decisions ----

  const lines = (value: string) => ({ ...useB, lines: value });

  for (const [name, records] of [
    ['one record covers every uncovered line', [lines('3, 5-6')]],
    ['a wider range covers them', [lines('1-10')]],
    ['two records cover them together', [lines('3'), { ...lines('5-6'), decision: 'kept-as-is' }]],
  ] as const) {
    it(`leaves out a gap when ${name}`, () => {
      const { markdown, approved } = approve('all', gaps, { decisions: [...records] });
      assert.doesNotMatch(markdown, /\d\. `frontend\/src\/useB\.ts`/);
      assert.deepEqual(approved.recommendations.map((item: { unit: string }) => item.unit), ['useA', 'useC']);
    });
  }

  it('lists a gap decided by two records once, with both decisions', () => {
    const { markdown } = approve('all', gaps, { decisions: [lines('3'), { ...lines('5-6'), decision: 'kept-as-is', reason: 'kept' }] });
    assert.match(markdown, /- `frontend\/src\/useB\.ts` useB — declined in #25, lines 3: useB is not worth testing; kept-as-is in #25, lines 5-6: kept\n/);
  });

  it('keeps a gap open, with a note naming the lines left, when the records cover only some of its lines', () => {
    const { markdown, approved } = approve('all', gaps, { decisions: [lines('3, 5')] });
    assert.match(markdown, /2\. `frontend\/src\/useB\.ts` useB[\s\S]*- decided earlier only in part \(declined in #25, lines 3, 5: useB is not worth testing\); line 6 is not: decide again/);
    assert.match(markdown, /## Decided earlier\nNone\./);
    assert.equal(approved.recommendations.length, 3);
  });

  for (const [name, uncovered, decided] of [
    ['the gap\'s line list', 'line 3', '3'],
    ['the record\'s line list', '3, 5-6', 'three'],
    ['a backwards range', '3, 5-6', '6-5'],
  ] as const) {
    it(`keeps a gap open when ${name} cannot be read`, () => {
      const content = { ...gaps, recommendations: gaps.recommendations.map((item) => ({ ...item, uncovered })) };
      const { markdown } = approve('all', content, { decisions: [lines(decided)] });
      assert.match(markdown, /2\. `frontend\/src\/useB\.ts` useB[\s\S]*the rest may not be: decide again/);
    });
  }

  it('rejects a gap list without the uncovered lines', () => {
    const { uncovered, ...withoutLines } = gaps.recommendations[0];
    const { code, stderr } = approve('all', { ...gaps, recommendations: [withoutLines] });
    assert.equal(uncovered, '3, 5-6');
    assert.equal(code, 1);
    assert.match(stderr, /gaps\.json is invalid[\s\S]*uncovered/);
  });

  it('rejects a record of decisions that breaks its schema', () => {
    const { code, stderr, approved } = approve('all', gaps, { decisions: [{ ...useB, decision: 'ignored' }] });
    assert.equal(code, 1);
    assert.match(stderr, /backfill-decisions\.json is invalid[\s\S]*"ignored" not one of/);
    assert.equal(approved, undefined);
  });

  // ---- declining ----

  it('writes the declined Recommendations with the reason to declined.json', () => {
    const { code, declined, stdout } = approve('1', gaps, { args: ['--decline', '3,2', '--reason', 'thin wrapper'] });
    assert.equal(code, 0);
    assert.deepEqual(declined, [
      { path: 'frontend/src/useC.ts', unit: 'useC', lines: '3, 5-6', reason: 'thin wrapper' },
      { path: 'frontend/src/useB.ts', unit: 'useB', lines: '3, 5-6', reason: 'thin wrapper' },
    ]);
    assert.match(stdout, /declined 2[\s\S]*make backfill-record PACKAGE=frontend PR=<n>/);
  });

  it('writes an empty declined.json when nothing is declined', () => {
    assert.deepEqual(approve('1').declined, []);
  });

  for (const [name, args] of [
    ['a decline without a reason', ['--decline', '2']],
    ['a blank reason', ['--decline', '2', '--reason', ' ']],
    ['an item both approved and declined', ['--decline', '1', '--reason', 'x']],
    ['a decline outside the list', ['--decline', '4', '--reason', 'x']],
  ] as const) {
    it(`rejects ${name} with exit 64 and writes nothing`, () => {
      const { code, approved, declined } = approve('1', gaps, { args: [...args] });
      assert.equal(code, 64);
      assert.equal(approved, undefined);
      assert.equal(declined, undefined);
    });
  }
});

describe('trial.ts record', () => {
  // A Backfill folder at the repo root with its sources, the owner's declines and the Author's Verdicts.
  function backfill(run: { declined?: object[]; units?: object[]; unreachable?: object[] }) {
    const root = tempDir();
    for (const unit of ['useA', 'useB', 'main']) file(root, `frontend/src/${unit}.ts`, source(unit));
    const out = join(root, 'out');
    if (run.declined) file(out, 'declined.json', JSON.stringify(run.declined));
    if (run.units) file(out, 'author.json', JSON.stringify({ summary: '', units: run.units }));
    if (run.unreachable) file(out, 'approved.json', JSON.stringify({ summary: '', recommendations: [], unreachable: run.unreachable, out_of_scope: [] }));
    return { root, out };
  }
  const record = (root: string, out: string, ...args: string[]) => {
    const result = runScript('local/trial.ts', ['record', '--out', out, '--package', 'frontend', ...args], { cwd: root });
    return { ...result, decisions: readIfExists(join(root, DECISIONS))?.decisions };
  };
  const unit = (name: string, verdict: string, reason?: string) => ({
    path: `src/${name}.ts`,
    unit: name,
    verdict,
    ...(reason ? { reason } : {}),
    expectations: [],
    attempts: 0,
  });

  it('records declines and not-needed Units with the PR and the blob of each file', () => {
    const { root, out } = backfill({
      declined: [{ path: 'frontend/src/useA.ts', unit: 'useA', lines: '2', reason: 'thin wrapper' }],
      units: [unit('useB', 'not-needed', 'trivial'), unit('main', 'not-needed', 'unreachable'), unit('useA', 'added')],
      unreachable: [{ path: 'frontend/src/main.ts', unit: 'main (startup)', uncovered: '1-3', reason: 'runs on import' }],
    });
    const { code, decisions, stdout } = record(root, out, '--pr', '41');
    assert.equal(code, 0);
    assert.deepEqual(decisions, [
      { package: 'frontend', path: 'frontend/src/main.ts', unit: 'main', lines: '1-3', decision: 'unreachable', reason: 'runs on import', pr: 41, blob: gitBlob(source('main')) },
      { package: 'frontend', path: 'frontend/src/useA.ts', unit: 'useA', lines: '2', decision: 'declined', reason: 'thin wrapper', pr: 41, blob: gitBlob(source('useA')) },
      { package: 'frontend', path: 'frontend/src/useB.ts', unit: 'useB', decision: 'declined', reason: 'Verdict not-needed (trivial)', pr: 41, blob: gitBlob(source('useB')) },
    ]);
    assert.match(stdout, /recorded 3 decisions from #41/);
  });

  it('replaces the decision for the same gap instead of adding a second one', () => {
    const { root, out } = backfill({ declined: [{ path: 'frontend/src/useA.ts', unit: 'useA', lines: '2', reason: 'thin wrapper' }] });
    record(root, out, '--pr', '41');
    file(root, 'frontend/src/useA.ts', 'export const useA = 2;\n');
    const { decisions } = record(root, out, '--pr', '42');
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].pr, 42);
    assert.equal(decisions[0].blob, gitBlob('export const useA = 2;\n'));
  });

  it('a recorded decline leaves its gap out of the next approval', () => {
    const { root, out } = backfill({ declined: [{ path: 'frontend/src/useA.ts', unit: 'useA', lines: '2', reason: 'thin wrapper' }] });
    record(root, out, '--pr', '41');
    const gaps = { summary: '', recommendations: [{ path: 'frontend/src/useA.ts', unit: 'useA', lines: '0', branches: '0', uncovered: '2', expectations: [] }], unreachable: [], out_of_scope: [] };
    file(out, 'gaps.json', JSON.stringify(gaps));
    const result = runScript('local/trial.ts', ['approve', '--out', out, '--package', 'frontend', '--items', 'none'], { cwd: root });
    assert.equal(result.code, 0);
    assert.match(readFileSync(join(out, 'gaps.md'), 'utf8'), /## Recommendations\nNone\.[\s\S]*useA — declined in #41, lines 2: thin wrapper/);
  });

  it('records nothing and says so when the run decided nothing, even for a tested Unit with a stray reason', () => {
    const { root, out } = backfill({ units: [unit('useA', 'added', 'trivial')] });
    const { code, decisions, stdout } = record(root, out, '--pr', '41');
    assert.equal(code, 0);
    assert.equal(decisions, undefined);
    assert.match(stdout, /nothing to record/);
  });

  for (const pr of [undefined, '0', 'x', '4.5']) {
    it(`exits 64 for --pr ${pr ?? 'missing'}`, () => {
      const { root, out } = backfill({ declined: [{ path: 'frontend/src/useA.ts', unit: 'useA', lines: '2', reason: 'thin wrapper' }] });
      const { code, decisions } = record(root, out, ...(pr === undefined ? [] : ['--pr', pr]));
      assert.equal(code, 64);
      assert.equal(decisions, undefined);
    });
  }
});

describe('trial.ts decide', () => {
  const decide = (root: string, ...args: string[]) => {
    const result = runScript('local/trial.ts', ['decide', '--package', 'backend', '--pr', '33', ...args], { cwd: root });
    return { ...result, decisions: readIfExists(join(root, DECISIONS))?.decisions };
  };
  const repoRoot = () => {
    const root = tempDir();
    file(root, 'backend/src/factory.ts', source('createApp'));
    return root;
  };

  it('records a kept-as-is Suspected Defect for one line range, and a second range of the same Unit beside it', () => {
    const root = repoRoot();
    decide(root, '--path', 'src/factory.ts', '--unit', 'createApp', '--lines', '20', '--decision', 'unreachable', '--reason', 'no route fails late');
    const { code, decisions } = decide(root, '--path', 'backend/src/factory.ts', '--unit', 'createApp', '--lines', '21-24', '--decision', 'kept-as-is', '--reason', ' kept on purpose ');
    assert.equal(code, 0);
    assert.deepEqual(decisions.map((entry: { lines: string; decision: string }) => `${entry.lines} ${entry.decision}`), ['20 unreachable', '21-24 kept-as-is']);
    assert.deepEqual(decisions[1], {
      package: 'backend',
      path: 'backend/src/factory.ts',
      unit: 'createApp',
      lines: '21-24',
      decision: 'kept-as-is',
      reason: 'kept on purpose',
      pr: 33,
      blob: gitBlob(source('createApp')),
    });
  });

  it('records a whole-file decision without a Unit', () => {
    const { decisions } = decide(repoRoot(), '--path', 'src/factory.ts', '--decision', 'unreachable', '--reason', 'runs on import');
    assert.equal(decisions[0].unit, undefined);
  });

  for (const [name, args, exit] of [
    ['an unknown decision', ['--path', 'src/factory.ts', '--decision', 'ignored', '--reason', 'x'], 64],
    ['a missing reason', ['--path', 'src/factory.ts', '--decision', 'declined'], 64],
    ['a missing path', ['--decision', 'declined', '--reason', 'x'], 64],
    ['a file that does not exist', ['--path', 'src/gone.ts', '--decision', 'declined', '--reason', 'x'], 1],
  ] as const) {
    it(`exits ${exit} for ${name} and writes nothing`, () => {
      const { code, decisions } = decide(repoRoot(), ...args);
      assert.equal(code, exit);
      assert.equal(decisions, undefined);
    });
  }

  it('exits 64 for an unknown package', () => {
    const result = runScript('local/trial.ts', ['decide', '--package', 'mobile', '--pr', '1', '--path', 'x', '--decision', 'declined', '--reason', 'x'], { cwd: repoRoot() });
    assert.equal(result.code, 64);
  });
});

// A hand edit that breaks the committed record would stop every later approval; catch it in verify instead.
// A stale entry is fine here: approve shows its gap again.
describe('the committed record of decisions', () => {
  it('matches its schema', () => {
    const record = JSON.parse(readFileSync(new URL(`../../../${DECISIONS}`, import.meta.url), 'utf8'));
    assert.deepEqual(validate(record, readSchema('../contracts/backfill-decisions.schema.json')), []);
  });
});

describe('trial.ts usage', () => {
  it('exits 64 for an unknown command', () => {
    assert.equal(runScript('local/trial.ts', ['toString']).code, 64);
  });
});
