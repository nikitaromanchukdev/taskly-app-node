// Markdown for the 3 sticky PR comments: report, test author, test reviewer.
// Every comment has the same shape: marker, `### {name} · {outcome}`, the meta line, what needs a person,
// the tables, then collapsed details and the agent's free text last. The outcome is counted by script.
import { isFlaggedDefect, packageRelative, unitKey, unitTests, writesTests } from '../lib/artifacts.ts';
import type { Check, Context, Defect, DefectDecision, Kind, MutationResult, Proof, Results, ReviewerOutput, Run, Severity, SummaryAgent, Unit } from '../lib/artifacts.ts';
import { cell, code, sanitize } from './sanitize.ts';
import { labelSkipNote, plural, proofOf, SCOPE_FAILED, testMissing } from './status.ts';
import type { ReasonRule, Status, StatusState } from './status.ts';
import type { SkipReason } from '../contracts/rules.ts';

export type CommentName = 'report' | 'author' | 'reviewer';
// What every comment is rendered from: the run's artifacts, its decided status and the repo for links.
export type Report = { run: Run; status: Status; repo: string };
type DefectLabel = DefectDecision | 'confirmed-unproven' | 'undecided';

export const COMMENTS: readonly CommentName[] = ['report', 'author', 'reviewer'];
// Each comment starts with its marker, so publish finds and updates it instead of adding another.
export const marker = (name: CommentName) => `<!-- pr-test-engineer:${name} -->`;

// The only emoji in the comments: 🟢 passes, 🔴 fails or turns the status red, ⚠️ needs a person but leaves the status as it is.
export const STATUS_EMOJI: Record<StatusState, string> = { success: '🟢', failure: '🔴' };
const CHECK_LABELS: Record<Check, string> = { pass: '🟢 pass', fail: '🔴 fail', skipped: 'skipped' };
const DEFECT_LABELS: Record<DefectLabel, string> = {
  confirmed: '🔴 confirmed',
  'confirmed-unproven': '⚠️ confirmed, not proven (warning)',
  rejected: '⚠️ rejected (warning)',
  undecided: '⚠️ no Reviewer decision (warning)',
};
const DECISION_LABELS: Record<DefectDecision, string> = { confirmed: '🔴 confirmed', rejected: '⚠️ rejected' };
const SEVERITY_LABELS: Record<Severity, string> = { blocking: '⚠️ blocking', advisory: 'advisory' };
const MAX_SURVIVORS = 20;
// Ranges of uncovered changed lines listed per file in the Report.
const MAX_UNCOVERED_RANGES = 10;
const TEST_MISSING = 'no test: the Author removed the Defect test instead of moving it to a file of its own. The Reviewer still confirmed it: check the code against its quote, or re-run the workflow to get the test';

// ---- Shared parts ----

const short = (sha: string) => sha.slice(0, 7);

function table(headers: string[], rows: string[][], empty: string): string[] {
  if (!rows.length) return [empty];
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [line(headers), `|${headers.map(() => '---').join('|')}|`, ...rows.map(line)];
}

// One count in a title's outcome; a part that is not always shown is left out at 0.
type OutcomePart = { count: number; text: (count: number) => string; always?: boolean };
const outcome = (parts: readonly OutcomePart[]) =>
  parts
    .filter((part) => part.always || part.count > 0)
    .map((part) => part.text(part.count))
    .join(', ');

const title = (name: string, result: string) => `### ${name} · ${result}`;
const NOT_RUN = 'not run';

// A collapsed section; always at the end of a comment.
const details = (summary: string, body: string[]) => [`<details><summary>${summary}</summary>`, '', ...body, '', '</details>'];

// The agent's free-text summary, after the tables. Model text is never the first thing a reader sees.
const notes = (who: string, text: string, repo: string) =>
  text.trim() ? ['', ...details(`${who}'s notes (free text, not checked)`, [sanitize(text, repo)])] : [];

// A warning after the tables when a summary names something agent-output.ts found in no Unit, test or file.
function unknownNamesLines(run: Run, agent: SummaryAgent, repo: string): string[] {
  const unknown = run.checked?.unknownNames?.[agent] ?? [];
  const names = unknown.map((name) => code(name, repo)).join(', ');
  const warning = `⚠️ The ${agent === 'author' ? 'Author' : 'Reviewer'}'s notes name ${names}, which no Unit, test or file of this run contains. The tables are checked; the notes are not.`;
  return unknown.length ? ['', warning] : [];
}

function header(context: Context): string {
  const final = context.analyzed_sha === context.final_sha ? '' : ` · final \`${short(context.final_sha)}\``;
  return `Analyzed \`${short(context.analyzed_sha)}\`${final} · [run](${context.run_url})`;
}

// Skip reasons of a PR that only adds tests, such as a Backfill PR: its tests and their coverage floors.
const TESTS_ONLY_REASONS: ReadonlySet<SkipReason> = new Set(['tests', 'config']);
const TESTS_ONLY =
  'this PR changes only tests and config, so there is nothing new to test. A Backfill PR runs the Author and Reviewer locally and lists their results in its description';

// The ADR, in docs/adr/, that explains each reason an agent did not run.
const ADR_SCOPE = '0002-test-changed-units-and-write-only-tests.md';
const ADR_FORKS = '0004-isolate-pr-code-from-secrets.md';
const ADR_LABEL = '0005-gate-merges-on-test-agent-verify.md';
const ADR_BACKFILL = '0008-run-the-backfill-locally-and-report-it-in-the-pr-description.md';

type NotRunReason = { why: string; adr?: string };
type NotRunRule = ReasonRule & { adr?: string };

function testsOnly(run: Run): boolean {
  const skipped = run.scope?.skipped ?? [];
  return (
    !run.scope?.candidates.length &&
    skipped.some((file) => file.reason === 'tests') &&
    skipped.every((file) => TESTS_ONLY_REASONS.has(file.reason))
  );
}

const NO_AGENT_REASONS: readonly NotRunRule[] = [
  { when: (run) => run.context.label_skip, reason: (run) => labelSkipNote(run.context), adr: ADR_LABEL },
  { when: (run) => !run.context.same_repo, reason: () => 'fork pull request', adr: ADR_FORKS },
  { when: (run) => run.context.jobs.scope !== 'success', reason: () => SCOPE_FAILED },
  { when: testsOnly, reason: () => TESTS_ONLY, adr: ADR_BACKFILL },
  { when: (run) => !run.scope?.candidates.length, reason: () => 'no testable changes', adr: ADR_SCOPE },
  { when: (run) => run.context.jobs.agents !== 'success', reason: () => 'the agent step failed or timed out' },
];

function whyNoAgent(run: Run): NotRunReason {
  const rule = NO_AGENT_REASONS.find((candidate) => candidate.when(run));
  return rule ? { why: rule.reason(run), adr: rule.adr } : { why: 'no agent output' };
}

const adrLink = (file: string, repo: string) => ` See [ADR ${file.slice(0, 4)}](https://github.com/${repo}/blob/main/docs/adr/${file}).`;
function notRun(run: Run, who: string, { why, adr }: NotRunReason, repo: string): string {
  return `${who} not run on \`${short(run.context.analyzed_sha)}\`: ${why}.${adr ? adrLink(adr, repo) : ''}`;
}
const unitName = (unit: { path: string; unit: string }, repo: string) => `${code(unit.path, repo)} ${cell(unit.unit, repo)}`;

const proofText = (proof: Proof) => (proof.state === 'proven' ? 'proven' : `unproven (${proof.reason})`);

// ---- Pipeline report ----

// Shown once the Author ran, even when empty; without Author output there is nothing to say.
function defectLines(run: Run, repo: string): string[] {
  if (!run.author) return [];
  const flagged = run.author.units.filter(isFlaggedDefect);
  const lines = flagged.flatMap((unit) => {
    const review = run.reviewer?.defects.find((decision) => unitKey(decision) === unitKey(unit));
    const defect = unit.defect;
    const proof = proofOf(run, unit);
    const missing = testMissing(run, unit);
    const confirmed = review?.decision === 'confirmed';
    const label = confirmed && proof.state === 'unproven' && !missing ? 'confirmed-unproven' : (review?.decision ?? 'undecided');
    const proofLine = missing ? TEST_MISSING : proofText(proof);
    return [
      `- ${DEFECT_LABELS[label]} · ${unitName(unit, repo)}`,
      `  - proof: ${proofLine}`,
      ...(defect
        ? [
            `  - test: ${cell(defect.test, repo)}`,
            `  - expected: ${cell(defect.expected, repo)}`,
            `  - received: ${cell(defect.received, repo)}`,
            `  - source: ${cell(defect.source, repo)}`,
          ]
        : []),
      ...(review ? [`  - Reviewer quote: ${cell(review.source_quote, repo)}`] : []),
    ];
  });
  return ['#### Defects', ...(lines.length ? lines : ['No Defects flagged.']), ''];
}

function skippedLines(run: Run, repo: string): string[] {
  const skipped = run.scope?.skipped ?? [];
  if (!skipped.length) return [];
  const items = skipped.map((file) => `- ${code(file.path, repo)} · ${file.reason}`);
  return [...details(`Skipped files (${skipped.length})`, items), ''];
}

function resultLines(results: Results | undefined, repo: string): string[] {
  if (!results) return ['#### Test results', 'No results (suites did not finish).', ''];
  const rows = [
    ...Object.entries(results.typecheck).map(([pkg, check]) => [`${pkg} typecheck`, CHECK_LABELS[check]]),
    ...Object.entries(results.thresholds ?? {}).filter(([, check]) => check === 'fail').map(([pkg]) => [`${pkg} coverage floor`, `${CHECK_LABELS.fail}: tests pass, vitest exited non-zero (a floor in its config was missed)`]),
    ...Object.entries(results.tests).map(([pkg, suite]) => [
      `${pkg} tests`,
      `${CHECK_LABELS[suite.status]} (${suite.passed} passed, ${suite.failed} failed)`,
    ]),
    ...results.flaky.map((flaky) => [
      `flaky ${code(flaky.file, repo)}`,
      `${CHECK_LABELS.fail}: failed in ${flaky.failedReruns} of ${flaky.reruns} shuffled reruns (${cell(flaky.tests.join('; '), repo)})`,
    ]),
  ];
  return ['#### Test results', ...table(['Check', 'Result'], rows, 'No checks.'), ''];
}

// Sorted line numbers as "3-5, 9, 12-13", at most `max` ranges, then "… N more".
export function lineRanges(lines: number[], max: number): string {
  const ranges: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let end = i;
    while (lines[end + 1] === lines[end] + 1) end++;
    ranges.push(end > i ? `${lines[i]}-${lines[end]}` : `${lines[i]}`);
    i = end;
  }
  const more = ranges.length - max;
  return more > 0 ? `${ranges.slice(0, max).join(', ')}, … ${more} more` : ranges.join(', ');
}

function coverageLines(run: Run, repo: string): string[] {
  const change = (before?: number, after?: number) =>
    before === undefined && after === undefined ? 'n/a' : `${before ?? 'n/a'} → ${after ?? 'n/a'}`;
  const rows = (run.scope?.candidates ?? []).map((candidate) => {
    const key = packageRelative(candidate);
    const before = run.results?.coverage.baseline[candidate.package]?.[key];
    const after = run.results?.coverage.final[candidate.package]?.[key];
    const changed = run.results?.changedLines?.[candidate.path];
    return [
      code(candidate.path, repo),
      changed ? `${changed.covered}/${changed.total}` : 'n/a',
      changed?.uncovered.length ? lineRanges(changed.uncovered, MAX_UNCOVERED_RANGES) : '',
      change(before?.lines, after?.lines),
      change(before?.branches, after?.branches),
    ];
  });
  const headers = ['File', 'Changed lines covered', 'Uncovered changed lines', 'File lines %', 'File branches %'];
  return ['#### Coverage of changed files', ...table(headers, rows, 'No changed source files.'), ''];
}

function mutationLines(results: Results | undefined, repo: string): string[] {
  const packages = Object.entries(results?.mutation ?? {});
  const perPackage = (pkg: string, mutation: MutationResult | null) => {
    if (!mutation) return [`- ${pkg}: not run`];
    const more = mutation.survived.length - MAX_SURVIVORS;
    return [
      `- ${pkg}: score ${mutation.score}%`,
      ...mutation.survived
        .slice(0, MAX_SURVIVORS)
        .map((mutant) => `  - survived: ${code(`${mutant.file}:${mutant.line}`, repo)} ${cell(mutant.mutator, repo)}`),
      ...(more > 0 ? [`  - … ${more} more`] : []),
    ];
  };
  const body = packages.length ? packages.flatMap(([pkg, mutation]) => perPackage(pkg, mutation)) : ['Not run.'];
  return details('Mutation (information only)', body);
}

function renderReport({ run, status, repo }: Report): string {
  const notVerified = notVerifiedLines(run, repo);
  return [
    marker('report'),
    title(`${STATUS_EMOJI[status.state]} Report`, status.description),
    header(run.context),
    '',
    ...defectLines(run, repo),
    ...(notVerified.length ? [...notVerified, ''] : []),
    ...resultLines(run.results, repo),
    ...coverageLines(run, repo),
    ...skippedLines(run, repo),
    ...mutationLines(run.results, repo),
  ].join('\n');
}

// ---- Author comment ----

// The Units left out of the Bot commit, by the Reviewer or by a Unit-level check of agent-output.ts.
type Rejected = { review: Set<string>; check: Set<string> };

function rejectedOf(run: Run): Rejected {
  return { review: new Set(run.checked?.reviewRejected ?? []), check: new Set((run.checked?.checkRejected ?? []).map(({ unit }) => unit)) };
}

const isRejected = (unit: Unit, { review, check }: Rejected) => review.has(unitKey(unit)) || check.has(unitKey(unit));

function verdictLabel(unit: Unit, rejected: Rejected): string {
  const tags = [rejected.review.has(unitKey(unit)) ? 'review-rejected' : '', rejected.check.has(unitKey(unit)) ? 'check-rejected' : ''].filter(Boolean);
  if (tags.length) return `${unit.verdict} (${tags.join(', ')})`;
  return unit.verdict === 'not-needed' ? `not-needed (${unit.reason})` : unit.verdict;
}

const MAX_CHECK_REJECTED = 10;
const MAX_CHECK_ERRORS = 3;
const MAX_CHECK_FILES = 5;

// Test files as a list, at most MAX_CHECK_FILES, then "… N more". Paths come from the agent's output, so they are sanitized.
function fileList(files: string[], repo: string): string {
  const more = files.length - MAX_CHECK_FILES;
  return `${files.slice(0, MAX_CHECK_FILES).map((file) => code(file, repo)).join(', ')}${more > 0 ? `, … ${more} more` : ''}`;
}

// The Units a check of agent-output.ts could not verify (ADR 0010): why, and which of their test files are in the Bot
// commit. Their tests count as no evidence: not in "N Units tested", and the coverage they give is no claim about them.
// The reasons carry names the agent wrote, so they are sanitized.
function notVerifiedLines(run: Run, repo: string): string[] {
  const rejected = run.checked?.checkRejected ?? [];
  if (!rejected.length) return [];
  const lines = rejected.slice(0, MAX_CHECK_REJECTED).map(({ unit, errors, kept, dropped }) => {
    const more = errors.length - MAX_CHECK_ERRORS;
    const reasons = `${errors.slice(0, MAX_CHECK_ERRORS).map((error) => cell(error, repo)).join('; ')}${more > 0 ? `; … ${more} more` : ''}`;
    const files = [
      kept.length ? `tests in the Bot commit: ${fileList(kept, repo)}` : '',
      dropped.length ? `tests left out of the Bot commit: ${fileList(dropped, repo)}` : '',
    ].filter(Boolean);
    return `- ${cell(unit, repo)}: ${reasons}${files.length ? ` (${files.join('; ')})` : ''}`;
  });
  const more = rejected.length - MAX_CHECK_REJECTED;
  const heading = 'Check-rejected, so not verified: a check found a slip in these Units\' output. The tests listed as in the Bot commit are there and ran, but they count as no evidence of these Units: not as tested, and not as coverage. Fix the labels and re-run the workflow.';
  return [`⚠️ ${heading}`, ...lines, ...(more > 0 ? [`- … ${more} more`] : [])];
}

const KINDS: readonly Kind[] = ['intent', 'characterization'];

// One kind when every test shares it, else "mixed" with the number of tests of each kind.
function kindLabel(unit: Unit): string {
  const counts = KINDS.map((kind) => ({ kind, tests: unit.expectations.filter((e) => e.kind === kind).flatMap((e) => e.tests).length }));
  const present = counts.filter(({ tests }) => tests > 0);
  switch (present.length) {
    case 0:
      return '—';
    case 1:
      return present[0].kind;
    default:
      return `mixed (${present.map(({ kind, tests }) => `${tests} ${kind}`).join(', ')})`;
  }
}

const flaggedLine = (unit: Unit, defect: Defect, repo: string) =>
  `- ${unitName(unit, repo)}: expected ${cell(defect.expected, repo)}, received ${cell(defect.received, repo)} (${cell(defect.source, repo)})`;

// "Tested" counts as the status headline does: Units with tests that were not review-rejected or check-rejected.
function authorOutcome(units: readonly Unit[], rejected: Rejected): string {
  const count = (when: (unit: Unit) => boolean) => units.filter(when).length;
  return outcome([
    { count: count((unit) => writesTests(unit.verdict) && !isRejected(unit, rejected)), text: (n) => `${plural(n, 'Unit')} tested`, always: true },
    { count: count((unit) => unit.verdict === 'not-needed'), text: (n) => `${n} not needed` },
    { count: count((unit) => rejected.review.has(unitKey(unit))), text: (n) => `${n} review-rejected` },
    { count: count((unit) => rejected.check.has(unitKey(unit))), text: (n) => `${n} check-rejected` },
    { count: count(isFlaggedDefect), text: (n) => `${plural(n, 'Defect')} flagged` },
  ]);
}

function renderAuthor({ run, repo }: Report): string {
  const top = (result: string) => [marker('author'), title('Test author', result), header(run.context), ''];
  if (!run.author) return [...top(NOT_RUN), notRun(run, 'Author', whyNoAgent(run), repo)].join('\n');

  const rejected = rejectedOf(run);
  const notVerified = notVerifiedLines(run, repo);
  const rows = run.author.units.map((unit) => [
    unitName(unit, repo),
    verdictLabel(unit, rejected),
    kindLabel(unit),
    unitTests(unit).map((test) => cell(test, repo)).join('<br>'),
    String(unit.attempts),
  ]);
  const defects = run.author.units.flatMap((unit) => (isFlaggedDefect(unit) && unit.defect ? [flaggedLine(unit, unit.defect, repo)] : []));
  return [
    ...top(authorOutcome(run.author.units, rejected)),
    ...table(['Unit', 'Verdict', 'Kind', 'Tests', 'Attempts'], rows, 'No Units.'),
    ...(notVerified.length ? ['', ...notVerified] : []),
    ...(defects.length ? ['', '#### Defects flagged', ...defects] : []),
    ...unknownNamesLines(run, 'author', repo),
    ...notes('Author', run.author.summary, repo),
  ].join('\n');
}

// ---- Reviewer comment ----

function reviewerOutcome({ defects, findings }: ReviewerOutput): string {
  const decided = (decision: DefectDecision) => defects.filter((defect) => defect.decision === decision).length;
  const blocking = findings.filter((finding) => finding.severity === 'blocking').length;
  return `${plural(decided('confirmed'), 'Defect')} confirmed, ${decided('rejected')} rejected, ${plural(findings.length, 'Finding')}${blocking ? ` (${blocking} blocking)` : ''}`;
}

function renderReviewer({ run, repo }: Report): string {
  const top = (result: string) => [marker('reviewer'), title('Test reviewer', result), header(run.context), ''];
  if (!run.reviewer) {
    const why = run.author ? { why: 'the author produced no tests or defects to review', adr: ADR_SCOPE } : whyNoAgent(run);
    return [...top(NOT_RUN), notRun(run, 'Reviewer', why, repo)].join('\n');
  }

  const decisions = run.reviewer.defects.map((decision) => [
    unitName(decision, repo),
    DECISION_LABELS[decision.decision],
    cell(decision.source_quote, repo),
  ]);
  const findings = run.reviewer.findings.map((finding) => [
    cell(finding.test, repo),
    SEVERITY_LABELS[finding.severity],
    finding.reason,
    cell(finding.note, repo) + (finding.severity === 'blocking' ? ' (test file dropped from the Bot commit)' : ''),
  ]);
  return [
    ...top(reviewerOutcome(run.reviewer)),
    '#### Defect decisions',
    ...table(['Unit', 'Decision', 'Source quote'], decisions, 'No Defects to decide.'),
    '',
    '#### Findings',
    ...table(['Test', 'Severity', 'Reason', 'Note'], findings, 'No Findings.'),
    ...unknownNamesLines(run, 'reviewer', repo),
    ...notes('Reviewer', run.reviewer.summary, repo),
  ].join('\n');
}

export const RENDERERS: Record<CommentName, (report: Report) => string> = {
  report: renderReport,
  author: renderAuthor,
  reviewer: renderReviewer,
};
