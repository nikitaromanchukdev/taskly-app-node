// context.ts turns the publish job's `needs` into context.json, for the job ids of either workflow version.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { Context } from '../lib/artifacts.ts';
import { runScript, tempDir } from './run.ts';

type Need = { result: string; outputs?: Record<string, string> };

const SCOPE_OUTPUTS = { head_sha: 'abcdef1234', same_repo: 'true', run_agent: 'true', label_skip: 'false', label_actor: '' };
const BOT_COMMIT_OUTPUTS = { final_sha: '1234567abc' };

function contextFor(needs: Record<string, Need>): Context {
  const dir = tempDir();
  const out = join(dir, 'context.json');
  const env = { NEEDS: JSON.stringify(needs), GITHUB_REPOSITORY: 'owner/repo', PR_NUMBER: '7', RUN_URL: 'https://example.invalid/run' };
  const result = runScript('workflow/context.ts', ['--out', out], { env });
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(readFileSync(out, 'utf8'));
}

const EXPECTED_JOBS = { scope: 'success', agents: 'success', bot_commit: 'failure', suites: 'skipped' };

describe('context.ts', () => {
  it('reads the current job ids', () => {
    const context = contextFor({
      scope: { result: 'success', outputs: SCOPE_OUTPUTS },
      agents: { result: 'success' },
      bot_commit: { result: 'failure', outputs: BOT_COMMIT_OUTPUTS },
      suites: { result: 'skipped' },
    });
    assert.deepEqual(context.jobs, EXPECTED_JOBS);
    assert.equal(context.analyzed_sha, 'abcdef1234');
    assert.equal(context.final_sha, '1234567abc');
    assert.equal(context.run_agent, true);
  });

  it('counts a job missing from needs as skipped', () => {
    const context = contextFor({ scope: { result: 'success', outputs: SCOPE_OUTPUTS } });
    assert.deepEqual(context.jobs, { scope: 'success', agents: 'skipped', bot_commit: 'skipped', suites: 'skipped' });
    assert.equal(context.final_sha, 'abcdef1234');
  });
});
