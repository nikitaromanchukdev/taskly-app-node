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
  it("cleans the current branch's folder and keeps its intent", () => {
    const root = repo();
    file(root, `${FOLDER}/pr-body.md`, 'intent');
    file(root, `${FOLDER}/author.json`, '{}');
    file(root, `${FOLDER}/round1/reviewer.json`, '{}');
    const result = trial(root, 'clean');
    assert.equal(result.code, 0);
    assert.doesNotMatch(result.stdout, /no output for this branch/);
    assert.ok(existsSync(join(root, FOLDER, 'pr-body.md')));
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

describe('trial.ts usage', () => {
  it('exits 64 for an unknown command', () => {
    assert.equal(runScript('trial.ts', ['toString']).code, 64);
  });
});
