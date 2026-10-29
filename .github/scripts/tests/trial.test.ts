// trial.ts runs the local trial's bookkeeping: per-branch output, the intended behaviour, cleanup, and the demo's verdict.
// Every test runs it without a terminal, so it takes the non-interactive path.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { AuthorOutput, Checked, ReviewerOutput } from '../artifacts.ts';
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

const trial = (root: string, ...args: string[]) => runScript('trial.ts', args, { cwd: root });
const file = (root: string, path: string, content: string) => {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), content);
};

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
    const result = trial(root, 'clean');
    assert.equal(result.code, 0);
    assert.doesNotMatch(result.stdout, /no output for this branch/);
    assert.ok(existsSync(join(root, FOLDER, 'pr-body.md')));
    assert.ok(existsSync(join(root, FOLDER, 'approved.json')));
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
  const okCheck: Checked = { ok: true, errors: [], dropFiles: [], reviewRejected: [] };

  // Writes a run's output and the expected outcome, then checks one against the other.
  function check(run: { author?: AuthorOutput; reviewer?: ReviewerOutput; checked?: Checked }) {
    const dir = tempDir();
    writeFileSync(join(dir, 'expected.json'), JSON.stringify(expected));
    for (const [name, value] of Object.entries(run)) writeFileSync(join(dir, `${name}.json`), JSON.stringify(value));
    return runScript('trial.ts', ['check', '--out', dir, '--expected', join(dir, 'expected.json')]);
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
    expectations: [{ text: `when ${unit} fails, then it shows an error`, source: 'README', kind: 'intent' }],
  });
  const gaps = {
    summary: 'Three gaps.',
    recommendations: [recommendation('useA'), recommendation('useB'), recommendation('useC')],
    unreachable: [{ path: 'frontend/src/main.tsx', unit: 'root', reason: 'runs on import' }],
    out_of_scope: [{ path: 'frontend/src/types.ts', reason: 'type-only' }],
  };

  // Writes gaps.json and runs approve without a terminal.
  function approve(items: string | undefined, content: unknown = gaps) {
    const dir = tempDir();
    writeFileSync(join(dir, 'gaps.json'), JSON.stringify(content));
    const result = runScript('trial.ts', ['approve', '--out', dir, ...(items === undefined ? [] : ['--items', items])]);
    const approved = existsSync(join(dir, 'approved.json')) ? JSON.parse(readFileSync(join(dir, 'approved.json'), 'utf8')) : undefined;
    return { ...result, dir, approved };
  }

  it('renders gaps.md with numbered Recommendations and the other two lists', () => {
    const { dir } = approve('all');
    const markdown = readFileSync(join(dir, 'gaps.md'), 'utf8');
    assert.match(markdown, /## Recommendations\n1\. `frontend\/src\/useA\.ts` useA — lines 50%, branches 25%/);
    assert.match(markdown, /3\. `frontend\/src\/useC\.ts` useC/);
    assert.match(markdown, /## Unreachable\n- `frontend\/src\/main\.tsx` root — runs on import/);
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
});

describe('trial.ts usage', () => {
  it('exits 64 for an unknown command', () => {
    assert.equal(runScript('trial.ts', ['toString']).code, 64);
  });
});
