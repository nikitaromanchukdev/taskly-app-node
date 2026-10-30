// publish job: decide the final status, render the 3 sticky PR comments and the job summary.
// Usage: node report.ts --dir <artifacts> [--post]
// Reads from <dir>: context.json (required), scope.json, author.json, reviewer.json, checked.json, results.json, proof.json.
// Writes to <dir>: status.json, report.md, author.md, reviewer.md. --post also writes status + comments to GitHub.
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { Context, Proof, Run } from '../lib/artifacts.ts';
import { die } from '../lib/cli.ts';
import { entryOf, mergeHistory, parseHistory, renderHistory } from './history.ts';
import { githubFromEnv } from './github.ts';
import type { GitHub } from './github.ts';
import { readJsonIfExists, writeJson } from '../lib/json.ts';
import { COMMENTS, marker, RENDERERS } from './render.ts';
import type { CommentName } from './render.ts';
import { STATUS_CONTEXT } from '../contracts/rules.ts';
import { truncate } from './sanitize.ts';
import { decide } from './status.ts';
import type { Status } from './status.ts';

type IssueComment = { id: number; user: { login: string } | null; body?: string };

const SCRIPT = 'report';
const BOT_LOGIN = 'github-actions[bot]';
// GitHub rejects comment bodies over 65536 characters; keep room for the truncation note.
const MAX_COMMENT = 60000;
const MAX_COMMENT_PAGES = 20;

// Room kept in the Report comment for its run history, which is added after the body is cut to size.
const HISTORY_ROOM = 12000;

// `build` gets the body of the comment being replaced, if there is one, and returns the new body.
async function upsert(gh: GitHub, repo: string, pr: number, name: CommentName, build: (previous: string | undefined) => string) {
  const comments = await gh.paginate<IssueComment>(`/repos/${repo}/issues/${pr}/comments`, MAX_COMMENT_PAGES);
  const mine = comments.find((comment) => comment.user?.login === BOT_LOGIN && comment.body?.startsWith(marker(name)));
  const text = build(mine?.body);
  return mine
    ? gh.request(`/repos/${repo}/issues/comments/${mine.id}`, { method: 'PATCH', body: { body: text } })
    : gh.request(`/repos/${repo}/issues/${pr}/comments`, { method: 'POST', body: { body: text } });
}

// The Report gets its run history after the body, so a cut body never loses it. The other comments have none.
function commentBody(name: CommentName, body: string, previous: string | undefined, context: Context, status: Status, repo: string): string {
  if (name !== 'report') return truncate(body, MAX_COMMENT);
  const entries = mergeHistory(parseHistory(previous, repo), entryOf(context, status, new Date(), repo));
  return truncate(body, MAX_COMMENT - HISTORY_ROOM) + '\n' + renderHistory(entries, repo);
}

async function post(gh: GitHub, repo: string, context: Context, status: Status, bodies: Record<CommentName, string>) {
  await gh.request(`/repos/${repo}/statuses/${context.final_sha}`, {
    method: 'POST',
    body: { state: status.state, context: STATUS_CONTEXT, description: status.description, target_url: context.run_url },
  });
  for (const name of COMMENTS) await upsert(gh, repo, context.pr, name, (previous) => commentBody(name, bodies[name], previous, context, status, repo));
}

function loadRun(dir: string): Run {
  const load = <T>(name: string) => readJsonIfExists<T>(join(dir, name));
  return {
    context: load<Context>('context.json') ?? die(SCRIPT, 'context.json is required'),
    scope: load('scope.json'),
    author: load('author.json'),
    reviewer: load('reviewer.json'),
    checked: load('checked.json'),
    results: load('results.json'),
    proof: load<Proof[]>('proof.json'),
  };
}

async function main(env: Record<string, string | undefined>) {
  const { values } = parseArgs({ options: { dir: { type: 'string' }, post: { type: 'boolean', default: false } } });
  const dir = values.dir ?? die(SCRIPT, 'usage: report.ts --dir <artifacts> [--post]', 'usage');
  const repo = env.GITHUB_REPOSITORY?.trim() ?? '';
  if (values.post && !repo) die(SCRIPT, 'GITHUB_REPOSITORY is not set');
  const run = loadRun(dir);

  const status = decide(run);
  const bodies = Object.fromEntries(COMMENTS.map((name) => [name, RENDERERS[name]({ run, status, repo })])) as Record<CommentName, string>;
  writeJson(join(dir, 'status.json'), status);
  for (const name of COMMENTS) writeFileSync(join(dir, `${name}.md`), bodies[name] + '\n');
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, bodies.report + '\n');
  console.log(`${SCRIPT}: ${status.state}: ${status.description}`);

  if (!values.post || !run.context.same_repo) return;
  await post(githubFromEnv(env), repo, run.context, status, bodies);
}

if (import.meta.main) 
  await main(process.env).catch((error: Error) => die(SCRIPT, error.message));
