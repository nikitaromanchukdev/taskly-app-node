// The final test-agent/verify status, decided from the run's artifacts.
import { isFlaggedDefect, unitKey, writesTests } from '../lib/artifacts.ts';
import type { Context, Run, Unit } from '../lib/artifacts.ts';
import { LABEL_SKIP_PHRASE } from '../contracts/rules.ts';

export type StatusState = 'success' | 'failure';
export type Status = { state: StatusState; description: string };

// An ordered list of conditions; the first one that holds gives the reason.
export type ReasonRule = { when: (run: Run) => boolean; reason: (run: Run) => string };

// GitHub's limit for a commit status description.
const MAX_STATUS_DESCRIPTION = 140;
export const SCOPE_FAILED = 'scope job failed';

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
export const firstReason = (rules: readonly ReasonRule[], run: Run) => rules.find((rule) => rule.when(run))?.reason(run);
export const labelSkipNote = (context: Context) => `${LABEL_SKIP_PHRASE} (@${context.label_actor})`;

function confirmedDefects(run: Run): Unit[] {
  const confirmed = new Set((run.reviewer?.defects ?? []).filter((defect) => defect.decision === 'confirmed').map(unitKey));
  return (run.author?.units ?? []).filter((unit) => isFlaggedDefect(unit) && confirmed.has(unitKey(unit)));
}

// The first agent step that failed explains the agent part.
const AGENT_FAILURES: readonly ReasonRule[] = [
  { when: (run) => run.context.jobs.agents !== 'success', reason: () => 'author or reviewer did not finish' },
  { when: (run) => run.context.jobs.bot_commit !== 'success', reason: () => 'Bot commit job failed' },
  { when: (run) => !run.author || !run.checked, reason: () => 'agent output missing' },
  { when: (run) => !run.checked?.ok, reason: () => 'agent output invalid or patch rejected' },
];

// Green needs the suites job to have succeeded: that job fails when a typecheck or a suite fails, and its result comes
// from GitHub, not from a file. results.json comes from a job that ran PR code, so it is untrusted: it can add red
// reasons (they name what failed) and never remove one.
function verifyFailure(run: Run): string | undefined {
  const failed = [
    ...Object.entries(run.results?.typecheck ?? {}).filter(([, check]) => check === 'fail').map(([pkg]) => `${pkg} typecheck`),
    ...Object.entries(run.results?.tests ?? {}).filter(([, suite]) => suite.status === 'fail').map(([pkg]) => `${pkg} tests`),
  ];
  if (failed.length) return `${failed.join(', ')} failed`;
  switch (run.context.jobs.suites) {
    case 'success':
      return run.results ? undefined : 'suites did not finish';
    case 'failure':
      return run.results ? 'suites job failed' : 'suites did not finish';
    default:
      return 'suites did not finish';
  }
}

function headline(run: Run): string {
  if (!run.context.run_agent) return 'no agent run; suites pass';
  const rejected = new Set(run.checked?.reviewRejected ?? []);
  const tested = (run.author?.units ?? []).filter((unit) => writesTests(unit.verdict) && !rejected.has(unitKey(unit))).length;
  return `${plural(tested, 'unit')} tested, ${plural(confirmedDefects(run).length, 'confirmed defect')}`;
}

export function decide(run: Run): Status {
  const defects = confirmedDefects(run).length;
  const reasons = [
    run.context.jobs.scope !== 'success' ? SCOPE_FAILED : undefined,
    run.context.run_agent ? firstReason(AGENT_FAILURES, run) : undefined,
    verifyFailure(run),
    defects ? plural(defects, 'confirmed defect') : undefined,
  ].filter((reason) => reason !== undefined);

  const prefix = run.context.label_skip ? `${labelSkipNote(run.context)}; ` : '';
  const summary = reasons.length ? reasons.join('; ') : headline(run);
  return { state: reasons.length ? 'failure' : 'success', description: (prefix + summary).slice(0, MAX_STATUS_DESCRIPTION) };
}
