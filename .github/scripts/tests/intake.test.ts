// intake.ts checks the untrusted intake artifact and the live PR before any job acts on them.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { GitHub } from '../workflow/github.ts';
import { main, parseIntake, stopReason } from '../workflow/intake.ts';
import { runScript, tempDir } from './run.ts';

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const REPO = 'owner/repo';
const GOOD = { pr: 12, head_sha: SHA, action: 'synchronize', label: '' };

const live = (overrides: Record<string, unknown> = {}) => ({
  state: 'open',
  head: { sha: SHA, ref: 'feat/issue-5-x', repo: { full_name: REPO } },
  base: { ref: 'main', repo: { full_name: REPO } },
  ...overrides,
});
const expected = { repo: REPO, headShas: [SHA, SHA], runHeadRepo: REPO };

describe('parseIntake', () => {
  const problem = (text: string) => {
    const parsed = parseIntake(text);
    assert.equal(parsed.ok, false, `accepted ${text}`);
    return parsed.ok ? '' : parsed.problem;
  };

  it('accepts a well-formed artifact', () => {
    assert.deepEqual(parseIntake(JSON.stringify(GOOD)), { ok: true, intake: GOOD });
    assert.equal(parseIntake(JSON.stringify({ ...GOOD, action: 'labeled', label: 'skip-test-agent' })).ok, true);
  });

  it('rejects text that is not a JSON object', () => {
    assert.match(problem('{nope'), /not JSON/);
    assert.match(problem('[1]'), /must be a JSON object/);
    assert.match(problem('null'), /must be a JSON object/);
  });

  it('rejects an artifact over 1 KB', () => {
    assert.match(problem(JSON.stringify({ ...GOOD, label: 'x'.repeat(2000) })), /limit is 1024/);
  });

  it('rejects unknown and missing keys', () => {
    assert.match(problem(JSON.stringify({ ...GOOD, extra: 1 })), /unknown keys: extra/);
    assert.match(problem(JSON.stringify({ pr: 12, head_sha: SHA, action: 'opened' })), /label is missing/);
  });

  it('rejects a bad PR number', () => {
    for (const pr of ['12', 0, -1, 1.5, 1234567890, null]) assert.match(problem(JSON.stringify({ ...GOOD, pr })), /pr must be/, String(pr));
  });

  it('rejects a bad head SHA', () => {
    for (const head_sha of ['abc', 'A'.repeat(40), `${SHA}0`, '$(id)', 5]) assert.match(problem(JSON.stringify({ ...GOOD, head_sha })), /head_sha must be/);
  });

  it('rejects actions outside the list, including inherited object keys', () => {
    for (const action of ['dispatch', 'closed', 'toString', 'constructor', '']) {
      assert.match(problem(JSON.stringify({ ...GOOD, action })), /action must be one of/, action);
    }
  });

  it('rejects any label but the skip label', () => {
    for (const label of ['bug', 'skip-test-agent ', '$(id)']) assert.match(problem(JSON.stringify({ ...GOOD, label })), /label must be/, label);
  });

  it('lists every problem at once', () => {
    const text = problem(JSON.stringify({ pr: 'x', head_sha: 'y', action: 'z', label: 'w' }));
    for (const field of ['pr must', 'head_sha must', 'action must', 'label must']) assert.ok(text.includes(field), text);
  });
});

describe('stopReason', () => {
  it('lets a same-repo open PR at the expected head through', () => {
    assert.equal(stopReason(live(), expected), undefined);
  });

  it('stops for a closed PR', () => {
    assert.match(stopReason(live({ state: 'closed' }), expected) ?? '', /PR is closed/);
  });

  it('stops for a fork, a deleted fork, and a foreign base', () => {
    const fork = live({ head: { sha: SHA, ref: 'x', repo: { full_name: 'someone/repo' } } });
    assert.match(stopReason(fork, expected) ?? '', /fork PRs get no run/);
    assert.match(stopReason(live({ head: { sha: SHA, ref: 'x', repo: null } }), expected) ?? '', /deleted repo/);
    assert.match(stopReason(live({ base: { ref: 'main', repo: { full_name: 'other/repo' } } }), expected) ?? '', /only owner\/repo/);
  });

  it('stops when the workflow run came from another repo', () => {
    assert.match(stopReason(live(), { ...expected, runHeadRepo: 'someone/repo' }) ?? '', /came from someone\/repo/);
  });

  it('stops when the head moved, whichever source is stale', () => {
    assert.match(stopReason(live(), { ...expected, headShas: [OTHER_SHA, SHA] }) ?? '', /newer push/);
    assert.match(stopReason(live(), { ...expected, headShas: [SHA, OTHER_SHA] }) ?? '', /newer push/);
  });

  it('accepts any head when none is claimed (dispatch)', () => {
    assert.equal(stopReason(live(), { ...expected, headShas: [] }), undefined);
  });

  it('stops for branch names with characters outside the safe set', () => {
    for (const ref of ['-flag', 'a b', 'a;id', 'a$(id)', 'a\nb', '']) {
      const head = { sha: SHA, ref, repo: { full_name: REPO } };
      assert.match(stopReason(live({ head }), expected) ?? '', /head branch name/, JSON.stringify(ref));
    }
    assert.match(stopReason(live({ base: { ref: '--x', repo: { full_name: REPO } } }), expected) ?? '', /base branch name/);
  });
});

describe('intake.ts main', () => {
  const fakeGitHub = (pr: unknown): GitHub => ({
    request: async <T>() => pr as T,
    paginate: async <T>() => [] as T[],
  });

  function run(env: Record<string, string>, pr: unknown) {
    const dir = tempDir();
    const output = join(dir, 'output');
    writeFileSync(output, '');
    return main({ GITHUB_REPOSITORY: REPO, GITHUB_OUTPUT: output, ...env }, fakeGitHub(pr)).then(() => readFileSync(output, 'utf8'));
  }
  const artifact = (value: unknown) => {
    const file = join(tempDir(), 'intake.json');
    writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
    return file;
  };
  const runEnv = (file: string, runPr = '12') => ({ EVENT_NAME: 'workflow_run', INTAKE_FILE: file, RUN_PR: runPr, RUN_HEAD_SHA: SHA, RUN_HEAD_REPO: REPO });

  it('writes the validated outputs from the live PR', async () => {
    const out = await run(runEnv(artifact(GOOD)), live());
    assert.equal(out, `stop=false\npr=12\nhead_sha=${SHA}\nhead_ref=feat/issue-5-x\nbase_ref=main\naction=synchronize\nlabel=\n`);
  });

  it('writes only stop=true when a check stops', async () => {
    const out = await run(runEnv(artifact(GOOD)), live({ state: 'closed' }));
    assert.equal(out, 'stop=true\n');
  });

  it('binds the PR to the workflow run, not the artifact', async () => {
    let asked = '';
    const gh: GitHub = { request: (async (path: string) => ((asked = path), live())) as GitHub['request'], paginate: async <T>() => [] as T[] };
    const output = join(tempDir(), 'output');
    writeFileSync(output, '');
    await main({ GITHUB_REPOSITORY: REPO, GITHUB_OUTPUT: output, ...runEnv(artifact(GOOD), '12') }, gh);
    assert.equal(asked, `/repos/${REPO}/pulls/12`);
  });

  it('stops when the workflow run lists no PR (a fork)', async () => {
    assert.equal(await run(runEnv(artifact(GOOD), ''), live()), 'stop=true\n');
  });

  it('stops when the artifact names another PR than the workflow run', async () => {
    assert.equal(await run(runEnv(artifact({ ...GOOD, pr: 99 }), '12'), live()), 'stop=true\n');
  });

  it('takes the PR from the input on a dispatch, with action dispatch', async () => {
    const out = await run({ EVENT_NAME: 'workflow_dispatch', DISPATCH_PR: '7' }, live());
    assert.match(out, /^stop=false\npr=7\n/);
    assert.match(out, /action=dispatch\nlabel=\n$/);
  });

  it('uses the live head, not a value from the artifact, for the outputs', async () => {
    const out = await run({ EVENT_NAME: 'workflow_dispatch', DISPATCH_PR: '7' }, live({ head: { sha: OTHER_SHA, ref: 'r', repo: { full_name: REPO } } }));
    assert.ok(out.includes(`head_sha=${OTHER_SHA}`), out);
  });
});

describe('intake.ts as a process', () => {
  const exec = (env: Record<string, string>) => runScript('workflow/intake.ts', [], { env: { GITHUB_REPOSITORY: REPO, GITHUB_TOKEN: 't', ...env } });
  const file = (content: string) => {
    const path = join(tempDir(), 'intake.json');
    writeFileSync(path, content);
    return path;
  };
  const base = { EVENT_NAME: 'workflow_run', RUN_PR: '12', RUN_HEAD_SHA: SHA, RUN_HEAD_REPO: REPO };

  it('fails with the reason on a malformed artifact, before any API call', () => {
    const result = exec({ ...base, INTAKE_FILE: file(JSON.stringify({ ...GOOD, pr: '12; id' })) });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /bad intake artifact: pr must be/);
  });

  it('fails on an artifact over 1 KB without parsing it', () => {
    const result = exec({ ...base, INTAKE_FILE: file('x'.repeat(5000)) });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /5000 bytes; the limit is 1024/);
  });

  it('fails when the artifact is missing', () => {
    const result = exec({ ...base, INTAKE_FILE: '/nonexistent/intake.json' });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /cannot read/);
  });

  it('fails on a RUN_PR that is not a PR number', () => {
    const result = exec({ ...base, RUN_PR: '1; id', INTAKE_FILE: file(JSON.stringify(GOOD)) });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /RUN_PR must be a PR number/);
  });

  it('rejects other events and a bad dispatch input', () => {
    assert.match(exec({ EVENT_NAME: 'pull_request' }).stderr, /not accepted/);
    const dispatch = exec({ EVENT_NAME: 'workflow_dispatch', DISPATCH_PR: '1; id' });
    assert.equal(dispatch.code, 1);
    assert.match(dispatch.stderr, /must be a PR number/);
  });
});
