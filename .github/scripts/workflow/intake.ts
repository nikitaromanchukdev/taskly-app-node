// intake job (workflow pr-test-engineer): check the intake artifact of workflow pr-intake against the live PR.
// The artifact is untrusted data: a same-repo author can edit pr-intake.yml, so every field is a hint to compare with the API.
// Usage: node intake.ts
// The PR is bound from the workflow_run event (its pull_requests[0] and head_sha), not from the artifact: the artifact
// only gives hints (action, label), and a different PR number or head SHA in it stops the run.
// Env: EVENT_NAME (workflow_run | workflow_dispatch), GITHUB_REPOSITORY, GITHUB_TOKEN, GITHUB_OUTPUT,
//      workflow_run: INTAKE_FILE (downloaded intake.json), RUN_PR (pull_requests[0].number, empty for a fork PR),
//      RUN_HEAD_SHA, RUN_HEAD_REPO
//      workflow_dispatch: DISPATCH_PR
// Outputs: stop (true | false), and when false: pr, head_sha, head_ref, base_ref, action, label. Every output is validated.
// A stop prints its reason and posts nothing. A malformed artifact fails the job with the reason.
import { appendFileSync, readFileSync, statSync } from 'node:fs';
import { die } from '../lib/cli.ts';
import { githubFromEnv } from './github.ts';
import type { GitHub } from './github.ts';
import { SKIP_LABEL } from '../contracts/rules.ts';

type Env = Record<string, string | undefined>;
type ArtifactAction = 'opened' | 'synchronize' | 'reopened' | 'ready_for_review' | 'labeled' | 'unlabeled';
type RunAction = ArtifactAction | 'dispatch';
type IntakeField = 'pr' | 'head_sha' | 'action' | 'label';
type Intake = { pr: number; head_sha: string; action: ArtifactAction; label: string };
type Parsed = { ok: true; intake: Intake } | { ok: false; problem: string };
type EventName = 'workflow_run' | 'workflow_dispatch';
type OutputValue = string | number | boolean;

// What the checks compare the live PR with. headShas is empty for a dispatch, which has no artifact.
type Expected = { repo: string; headShas: string[]; runHeadRepo: string };
type StopCheck = (pr: PullRequest, expected: Expected) => string | undefined;

// The parts of the GitHub API response this script reads.
type PullRequest = {
  state: string;
  head: { sha: string; ref: string; repo: { full_name: string } | null };
  base: { ref: string; repo: { full_name: string } | null };
};

const SCRIPT = 'intake';
const MAX_ARTIFACT_BYTES = 1024;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const PR_PATTERN = /^[1-9][0-9]{0,8}$/;
const REF_PATTERN = /^[A-Za-z0-9._/-]+$/;

// Own keys only: 'constructor' and 'toString' must not pass as actions.
const ARTIFACT_ACTIONS: Record<ArtifactAction, true> = {
  opened: true,
  synchronize: true,
  reopened: true,
  ready_for_review: true,
  labeled: true,
  unlabeled: true,
};
const INTAKE_FIELDS: readonly IntakeField[] = ['pr', 'head_sha', 'action', 'label'];

const isPrNumber = (value: unknown): value is number => typeof value === 'number' && PR_PATTERN.test(String(value));
const isArtifactAction = (value: unknown): value is ArtifactAction => typeof value === 'string' && Object.hasOwn(ARTIFACT_ACTIONS, value);

// One entry per field: the problem with a value, or undefined.
const FIELD_CHECKS: Record<IntakeField, (value: unknown) => string | undefined> = {
  pr: (value) => (isPrNumber(value) ? undefined : `pr must be a positive integer of at most 9 digits, got ${JSON.stringify(value)}`),
  head_sha: (value) =>
    typeof value === 'string' && SHA_PATTERN.test(value) ? undefined : `head_sha must be 40 lowercase hex characters, got ${JSON.stringify(value)}`,
  action: (value) =>
    isArtifactAction(value) ? undefined : `action must be one of ${Object.keys(ARTIFACT_ACTIONS).join(', ')}, got ${JSON.stringify(value)}`,
  label: (value) =>
    value === '' || value === SKIP_LABEL ? undefined : `label must be "" or "${SKIP_LABEL}", got ${JSON.stringify(value)}`,
};

export function parseIntake(text: string): Parsed {
  const bytes = Buffer.byteLength(text);
  if (bytes > MAX_ARTIFACT_BYTES) return { ok: false, problem: `intake.json is ${bytes} bytes; the limit is ${MAX_ARTIFACT_BYTES}` };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { ok: false, problem: `intake.json is not JSON (${(error as Error).message})` };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { ok: false, problem: 'intake.json must be a JSON object' };
  const record = data as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !INTAKE_FIELDS.includes(key as IntakeField));
  if (unknown.length) return { ok: false, problem: `intake.json has unknown keys: ${unknown.join(', ')}` };
  const problems = INTAKE_FIELDS.map((field) => (Object.hasOwn(record, field) ? FIELD_CHECKS[field](record[field]) : `${field} is missing`));
  const found = problems.filter((problem) => problem !== undefined);
  if (found.length) return { ok: false, problem: found.join('; ') };
  return { ok: true, intake: record as Intake };
}

// ---- Stop checks, in order. The first reason wins. ----

const STOP_CHECKS: readonly StopCheck[] = [
  (pr) => (pr.state === 'open' ? undefined : `the PR is ${pr.state}`),
  (pr, { repo }) =>
    pr.head.repo?.full_name === repo && pr.base.repo?.full_name === repo
      ? undefined
      : `the PR head is ${pr.head.repo?.full_name ?? 'a deleted repo'} and its base is ${pr.base.repo?.full_name ?? 'a deleted repo'}; only ${repo} is analyzed (fork PRs get no run)`,
  (_pr, { repo, runHeadRepo }) => (runHeadRepo === repo ? undefined : `the workflow run came from ${runHeadRepo}, not ${repo}`),
  (pr, { headShas }) => {
    const stale = headShas.find((sha) => sha !== pr.head.sha);
    return stale === undefined ? undefined : `the PR head is ${pr.head.sha} now, but the run was for ${stale}; a newer push has its own run`;
  },
  (pr) => (REF_PATTERN.test(pr.head.ref) && !pr.head.ref.startsWith('-') ? undefined : `the head branch name "${pr.head.ref}" is not accepted`),
  (pr) => (REF_PATTERN.test(pr.base.ref) && !pr.base.ref.startsWith('-') ? undefined : `the base branch name "${pr.base.ref}" is not accepted`),
];

export function stopReason(pr: PullRequest, expected: Expected): string | undefined {
  for (const check of STOP_CHECKS) {
    const reason = check(pr, expected);
    if (reason !== undefined) return reason;
  }
  return undefined;
}

// ---- Sources of the claims, one per event ----

// stop: a reason found before the live PR is read. artifactPr and the SHAs are claims to compare, never to trust.
type Claims = { pr: string; action: RunAction; label: string; expected: Expected; stop?: string };
type ClaimReader = (env: Env, repo: string) => Claims;

const need = (env: Env, name: string): string => env[name]?.trim() || die(SCRIPT, `${name} is not set`);

function fromArtifact(env: Env, repo: string): Claims {
  const file = need(env, 'INTAKE_FILE');
  let text: string;
  try {
    // Check the size before reading: the artifact is untrusted.
    const size = statSync(file).size;
    if (size > MAX_ARTIFACT_BYTES) die(SCRIPT, `intake.json is ${size} bytes; the limit is ${MAX_ARTIFACT_BYTES}`);
    text = readFileSync(file, 'utf8');
  } catch (error) {
    return die(SCRIPT, `cannot read ${file}: ${(error as Error).message}`);
  }
  const parsed = parseIntake(text);
  if (!parsed.ok) return die(SCRIPT, `bad intake artifact: ${parsed.problem}`);
  const { intake } = parsed;
  const runHeadSha = need(env, 'RUN_HEAD_SHA');
  const runPr = (env.RUN_PR ?? '').trim();
  const expected = { repo, headShas: [intake.head_sha, runHeadSha], runHeadRepo: need(env, 'RUN_HEAD_REPO') };
  const claims = { pr: runPr, action: intake.action, label: intake.label, expected };
  if (!runPr) return { ...claims, stop: 'the workflow run lists no pull request (a fork PR, or a branch name that matches several)' };
  if (!PR_PATTERN.test(runPr)) return die(SCRIPT, `RUN_PR must be a PR number, got ${JSON.stringify(runPr)}`);
  if (String(intake.pr) !== runPr) return { ...claims, stop: `the artifact says PR #${intake.pr}, but the workflow run is for PR #${runPr}` };
  return claims;
}

function fromDispatch(env: Env, repo: string): Claims {
  const pr = need(env, 'DISPATCH_PR');
  if (!PR_PATTERN.test(pr)) die(SCRIPT, `the pull-request input must be a PR number, got ${JSON.stringify(pr)}`);
  return { pr, action: 'dispatch', label: '', expected: { repo, headShas: [], runHeadRepo: repo } };
}

const CLAIM_READERS: Record<EventName, ClaimReader> = { workflow_run: fromArtifact, workflow_dispatch: fromDispatch };
const isEventName = (value: string): value is EventName => Object.hasOwn(CLAIM_READERS, value);

function writeOutputs(outputFile: string | undefined, outputs: Record<string, OutputValue>) {
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
  if (outputFile) appendFileSync(outputFile, lines.join('\n') + '\n');
  console.log(lines.join('\n'));
}

export async function main(env: Env, gh: GitHub = githubFromEnv(env)) {
  const eventName = need(env, 'EVENT_NAME');
  if (!isEventName(eventName)) die(SCRIPT, `event ${eventName} is not accepted; expected workflow_run or workflow_dispatch`);
  const repo = need(env, 'GITHUB_REPOSITORY');
  const claims = CLAIM_READERS[eventName](env, repo);
  console.log(`${SCRIPT}: ${eventName} claims PR #${claims.pr}, action ${claims.action}, label "${claims.label}"`);
  if (claims.stop !== undefined) {
    console.log(`${SCRIPT}: stop, no status and no comment: ${claims.stop}`);
    return writeOutputs(env.GITHUB_OUTPUT, { stop: true });
  }

  const pr = await gh.request<PullRequest>(`/repos/${repo}/pulls/${claims.pr}`);
  const reason = stopReason(pr, claims.expected);
  if (reason !== undefined) {
    console.log(`${SCRIPT}: stop, no status and no comment: ${reason}`);
    return writeOutputs(env.GITHUB_OUTPUT, { stop: true });
  }
  console.log(`${SCRIPT}: PR #${claims.pr} head ${pr.head.sha} on ${pr.head.ref}, base ${pr.base.ref}`);
  writeOutputs(env.GITHUB_OUTPUT, {
    stop: false,
    pr: claims.pr,
    head_sha: pr.head.sha,
    head_ref: pr.head.ref,
    base_ref: pr.base.ref,
    action: claims.action,
    label: claims.label,
  });
}

if (import.meta.main) await main(process.env).catch((error: Error) => die(SCRIPT, error.message));
