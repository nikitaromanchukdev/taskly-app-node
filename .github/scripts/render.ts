// Markdown for the 3 sticky PR comments: report, test author, test reviewer.
import { isFlaggedDefect, packageRelative, unitKey } from './artifacts.ts';
import type { Context, Defect, DefectDecision, MutationResult, Results, Run, Unit } from './artifacts.ts';
import { cell, code, sanitize } from './sanitize.ts';
import { firstReason, labelSkipNote, PREPARE_FAILED } from './status.ts';
import type { ReasonRule, Status, StatusState } from './status.ts';
import type { SkipReason } from './rules.ts';

export type CommentName = 'report' | 'author' | 'reviewer';
// What every comment is rendered from: the run's artifacts, its decided status and the repo for links.
export type Report = { run: Run; status: Status; repo: string };
type DefectLabel = DefectDecision | 'undecided';

export const COMMENTS: readonly CommentName[] = ['report', 'author', 'reviewer'];
// Each comment starts with its marker, so publish finds and updates it instead of adding another.
export const marker = (name: CommentName) => `<!-- pr-test-engineer:${name} -->`;

const STATUS_EMOJI: Record<StatusState, string> = { success: '🟢', failure: '🔴' };
const DEFECT_LABELS: Record<DefectLabel, string> = {
  confirmed: '🔴 confirmed',
  rejected: '⚠️ rejected by reviewer (warning)',
  undecided: '⚠️ no reviewer decision (warning)',
};
const MAX_SURVIVORS = 20;

// ---- Shared parts ----

const short = (sha: string) => sha.slice(0, 7);

function table(headers: string[], rows: string[][], empty: string): string[] {
  if (!rows.length) return [empty];
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [line(headers), `|${headers.map(() => '---').join('|')}|`, ...rows.map(line)];
}

function header(context: Context): string {
  const final = context.analyzed_sha === context.final_sha ? '' : ` · final \`${short(context.final_sha)}\``;
  return `Analyzed \`${short(context.analyzed_sha)}\`${final} · [run](${context.run_url})`;
}

// Skip reasons of a PR that only adds tests, such as a Backfill PR: its tests and their coverage floors.
const TESTS_ONLY_REASONS: ReadonlySet<SkipReason> = new Set(['tests', 'config']);
const TESTS_ONLY =
  'this PR changes only tests and config, so there is nothing new to test. A Backfill PR runs the Author and Reviewer locally and lists their results in its description';
const TESTS_ONLY_ADR = 'docs/adr/0008-run-the-backfill-locally-and-report-it-in-the-pr-description.md';

function testsOnly(run: Run): boolean {
  const skipped = run.scope?.skipped ?? [];
  return (
    !run.scope?.candidates.length &&
    skipped.some((file) => file.reason === 'tests') &&
    skipped.every((file) => TESTS_ONLY_REASONS.has(file.reason))
  );
}

const NO_AGENT_REASONS: readonly ReasonRule[] = [
  { when: (run) => run.context.label_skip, reason: (run) => labelSkipNote(run.context) },
  { when: (run) => !run.context.same_repo, reason: () => 'fork pull request' },
  { when: (run) => run.context.jobs.prepare !== 'success', reason: () => PREPARE_FAILED },
  { when: testsOnly, reason: () => TESTS_ONLY },
  { when: (run) => !run.scope?.candidates.length, reason: () => 'no testable changes' },
  { when: (run) => run.context.jobs.engineer !== 'success', reason: () => 'the agent step failed or timed out' },
];

const whyNoAgent = (run: Run) => firstReason(NO_AGENT_REASONS, run) ?? 'no agent output';
// A tests-only PR also links the ADR that separates the Backfill from a PR run.
function notRun(run: Run, who: string, why: string, repo: string): string {
  const adr = why === TESTS_ONLY ? ` See [ADR 0008](https://github.com/${repo}/blob/main/${TESTS_ONLY_ADR}).` : '';
  return `${who} not run on \`${short(run.context.analyzed_sha)}\`: ${why}.${adr}`;
}
const unitName = (unit: { path: string; unit: string }, repo: string) => `${code(unit.path, repo)} ${cell(unit.unit, repo)}`;

// ---- Pipeline report ----

function defectLines(run: Run, repo: string): string[] {
  const flagged = run.author?.units.filter(isFlaggedDefect) ?? [];
  if (!flagged.length) return [];
  const lines = flagged.flatMap((unit) => {
    const review = run.reviewer?.defects.find((decision) => unitKey(decision) === unitKey(unit));
    const defect = unit.defect;
    return [
      `- ${DEFECT_LABELS[review?.decision ?? 'undecided']}: ${code(unit.unit, repo)} in ${code(unit.path, repo)}`,
      ...(defect
        ? [
            `  - test: ${cell(defect.test, repo)}`,
            `  - expected: ${cell(defect.expected, repo)}`,
            `  - received: ${cell(defect.received, repo)}`,
            `  - source: ${cell(defect.source, repo)}`,
          ]
        : []),
      ...(review ? [`  - reviewer quote: ${cell(review.source_quote, repo)}`] : []),
    ];
  });
  return ['#### Defects', ...lines, ''];
}

function skippedLines(run: Run, repo: string): string[] {
  const skipped = run.scope?.skipped ?? [];
  if (!skipped.length) return [];
  const items = skipped.map((file) => `- ${code(file.path, repo)} · ${file.reason}`);
  return ['<details><summary>Skipped files</summary>', '', ...items, '', '</details>', ''];
}

function resultLines(results: Results | undefined): string[] {
  if (!results) return ['#### Test results', 'No results (verification did not finish).', ''];
  const rows = [
    ...Object.entries(results.typecheck).map(([pkg, check]) => [`${pkg} typecheck`, check]),
    ...Object.entries(results.tests).map(([pkg, suite]) => [
      `${pkg} tests`,
      `${suite.status} (${suite.passed} passed, ${suite.failed} failed)`,
    ]),
  ];
  return ['#### Test results', ...table(['Check', 'Result'], rows, 'No checks.'), ''];
}

function coverageLines(run: Run, repo: string): string[] {
  const change = (before?: number, after?: number) =>
    before === undefined && after === undefined ? 'n/a' : `${before ?? 'n/a'} → ${after ?? 'n/a'}`;
  const rows = (run.scope?.candidates ?? []).map((candidate) => {
    const key = packageRelative(candidate);
    const before = run.results?.coverage.baseline[candidate.package]?.[key];
    const after = run.results?.coverage.final[candidate.package]?.[key];
    return [code(candidate.path, repo), change(before?.lines, after?.lines), change(before?.branches, after?.branches)];
  });
  return ['#### Coverage of changed files', ...table(['File', 'Lines %', 'Branches %'], rows, 'No changed source files.'), ''];
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
  return ['<details><summary>Mutation (information only)</summary>', '', ...body, '', '</details>'];
}

function renderReport({ run, status, repo }: Report): string {
  return [
    marker('report'),
    `### ${STATUS_EMOJI[status.state]} ${status.description}`,
    header(run.context),
    '',
    ...defectLines(run, repo),
    ...skippedLines(run, repo),
    ...resultLines(run.results),
    ...coverageLines(run, repo),
    ...mutationLines(run.results, repo),
  ].join('\n');
}

// ---- Author comment ----

function verdictLabel(unit: Unit, rejected: Set<string>): string {
  if (rejected.has(unitKey(unit))) return `${unit.verdict} (review-rejected)`;
  return unit.verdict === 'not-needed' ? `not-needed (${unit.reason})` : unit.verdict;
}

const flaggedLine = (unit: string, defect: Defect, repo: string) =>
  `- ${cell(unit, repo)}: expected ${cell(defect.expected, repo)}, received ${cell(defect.received, repo)} (${cell(defect.source, repo)})`;

function renderAuthor({ run, repo }: Report): string {
  const out = [marker('author'), '### Test author', header(run.context), ''];
  if (!run.author) return [...out, notRun(run, 'Author', whyNoAgent(run), repo)].join('\n');

  const rejected = new Set(run.checked?.reviewRejected ?? []);
  const rows = run.author.units.map((unit) => [
    unitName(unit, repo),
    verdictLabel(unit, rejected),
    unit.kind,
    unit.tests.map((test) => cell(test, repo)).join('<br>'),
    String(unit.attempts),
  ]);
  const defects = run.author.units.flatMap((unit) => (isFlaggedDefect(unit) && unit.defect ? [flaggedLine(unit.unit, unit.defect, repo)] : []));
  return [
    ...out,
    sanitize(run.author.summary, repo),
    '',
    ...table(['Unit', 'Verdict', 'Kind', 'Tests', 'Attempts'], rows, 'No units.'),
    ...(defects.length ? ['', '#### Defects as flagged by the author', ...defects] : []),
  ].join('\n');
}

// ---- Reviewer comment ----

function renderReviewer({ run, repo }: Report): string {
  const out = [marker('reviewer'), '### Test reviewer', header(run.context), ''];
  if (!run.reviewer) {
    const why = run.author ? 'the author produced no tests or defects to review' : whyNoAgent(run);
    return [...out, notRun(run, 'Reviewer', why, repo)].join('\n');
  }

  const decisions = run.reviewer.defects.map((decision) => [
    unitName(decision, repo),
    decision.decision,
    cell(decision.source_quote, repo),
  ]);
  const findings = run.reviewer.findings.map((finding) => [
    cell(finding.test, repo),
    finding.severity,
    finding.reason,
    cell(finding.note, repo) + (finding.severity === 'blocking' ? ' (test file dropped from bot commit)' : ''),
  ]);
  return [
    ...out,
    sanitize(run.reviewer.summary, repo),
    '',
    '#### Defect decisions',
    ...table(['Unit', 'Decision', 'Source quote'], decisions, 'No defects to decide.'),
    '',
    '#### Findings',
    ...table(['Test', 'Severity', 'Reason', 'Note'], findings, 'No findings.'),
  ].join('\n');
}

export const RENDERERS: Record<CommentName, (report: Report) => string> = {
  report: renderReport,
  author: renderAuthor,
  reviewer: renderReviewer,
};
