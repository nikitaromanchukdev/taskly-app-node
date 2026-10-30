// publish job: build context.json (what the report comment needs to know about this run) from the job results.
// Usage: node context.ts [--out context.json]
// Env: NEEDS (toJSON(needs)), GITHUB_REPOSITORY, PR_NUMBER, RUN_URL, GITHUB_TOKEN.
// When the scope job did not get far enough to name the head commit, the live PR is read instead.
import { parseArgs } from 'node:util';
import type { Context, Job, JobResult } from '../lib/artifacts.ts';
import { die } from '../lib/cli.ts';
import { githubFromEnv } from './github.ts';
import { writeJson } from '../lib/json.ts';

type Env = Record<string, string | undefined>;
type Need = { result?: string; outputs?: Record<string, string> };
type Needs = Partial<Record<Job, Need>>;
type PullRequest = { head: { sha: string; repo: { full_name: string } | null } };

const SCRIPT = 'context';
const JOBS: readonly Job[] = ['scope', 'agents', 'bot_commit', 'suites'];
const JOB_RESULTS: Record<string, JobResult> = {
  success: 'success',
  failure: 'failure',
  cancelled: 'cancelled',
  skipped: 'skipped',
};

const result = (needs: Needs, job: Job): JobResult => JOB_RESULTS[needs[job]?.result ?? ''] ?? 'skipped';

async function main(env: Env) {
  const { values } = parseArgs({ options: { out: { type: 'string', default: 'context.json' } } });
  const needs = JSON.parse(env.NEEDS ?? '{}') as Needs;
  const repo = env.GITHUB_REPOSITORY?.trim() || die(SCRIPT, 'GITHUB_REPOSITORY is not set');
  const pr = Number(env.PR_NUMBER);
  if (!Number.isInteger(pr) || pr < 1) die(SCRIPT, 'PR_NUMBER is not set');

  const out = needs.scope?.outputs ?? {};
  let analyzed = out.head_sha ?? '';
  let sameRepo = out.same_repo === 'true';
  if (!analyzed) {
    const live = await githubFromEnv(env).request<PullRequest>(`/repos/${repo}/pulls/${pr}`);
    analyzed = live.head.sha;
    sameRepo = live.head.repo?.full_name === repo;
  }

  const context: Context = {
    pr,
    analyzed_sha: analyzed,
    final_sha: needs.bot_commit?.outputs?.final_sha || analyzed,
    run_url: env.RUN_URL ?? '',
    same_repo: sameRepo,
    label_skip: out.label_skip === 'true',
    label_actor: out.label_actor ?? '',
    run_agent: out.run_agent === 'true',
    jobs: Object.fromEntries(JOBS.map((job) => [job, result(needs, job)])) as Record<Job, JobResult>,
  };
  writeJson(values.out, context);
  console.log(`${SCRIPT}: PR #${pr} ${analyzed.slice(0, 7)} → ${context.final_sha.slice(0, 7)}`);
}

if (import.meta.main) await main(process.env).catch((error: Error) => die(SCRIPT, error.message));
