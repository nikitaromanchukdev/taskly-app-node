// The files one PR run passes between jobs, and small pure helpers over them.
// scope.json (scope) · author.json, reviewer.json (agents) · checked.json (bot_commit) · results.json (suites) · context.json (publish)
// Backfill only: gaps.json (the Author's gap list) · approved.json, declined.json (the owner's choice)
// · docs/backfill-decisions.json (committed: the gaps earlier Backfills decided)
import type { Pkg, SkipReason } from '../contracts/rules.ts';

// ---- scope.json ----

export type Hunk = { start: number; count: number };
export type CandidateStatus = 'added' | 'modified';
export type FileStatus = CandidateStatus | 'deleted';
export type Candidate = { path: string; package: Pkg; status: CandidateStatus; hunks: Hunk[] };
export type Skipped = { path: string; reason: SkipReason };
export type Budgets = {
  model: string;
  reviewerModel: string;
  maxTurns: number;
  timeoutMinutes: number;
  maxAttempts: number;
};
export type Scope = {
  base: string;
  head: string;
  budgets: Budgets;
  candidates: Candidate[];
  skipped: Skipped[];
};

// ---- author.json, reviewer.json (enums mirror the schemas) ----

export type Verdict = 'added' | 'amended' | 'not-needed' | 'flagged-defect';
export type Kind = 'intent' | 'characterization';
export type Severity = 'blocking' | 'advisory';
export type DefectDecision = 'confirmed' | 'rejected';
export type NotNeededReason = 'already-covered' | 'no-logic' | 'trivial' | 'not-unit-testable' | 'unreachable';

export type Expectation = { text: string; source: string; kind: Kind; tests: string[] };
export type Defect = { test: string; expected: string; received: string; source: string };
export type Unit = {
  path: string;
  unit: string;
  verdict: Verdict;
  reason?: NotNeededReason;
  expectations: Expectation[];
  attempts: number;
  defect?: Defect;
};
export type AuthorOutput = { summary: string; units: Unit[] };

export type Finding = { test: string; severity: Severity; reason: string; note: string };
export type DefectReview = { path: string; unit: string; decision: DefectDecision; source_quote: string };
export type ReviewerOutput = { summary: string; findings: Finding[]; defects: DefectReview[] };

// ---- gaps.json, approved.json (Backfill; enums mirror gaps.schema.json) ----

export type GapExpectation = { text: string; source: string; kind: Kind };
// uncovered: line numbers with an uncovered line, branch or function, e.g. "18, 20-22".
export type Recommendation = { path: string; unit: string; lines: string; branches: string; uncovered: string; expectations: GapExpectation[] };
export type UnreachableGap = { path: string; unit: string; uncovered: string; reason: string };
export type OutOfScopeFile = { path: string; reason: SkipReason };
// approved.json has the same shape, with only the Recommendations the owner approved.
export type Gaps = { summary: string; recommendations: Recommendation[]; unreachable: UnreachableGap[]; out_of_scope: OutOfScopeFile[] };
// declined.json: Recommendations the owner declined at approval. The PR number is not known yet, so they wait here.
export type DeclinedGap = { path: string; unit: string; lines: string; reason: string };

// ---- docs/backfill-decisions.json (enum mirrors backfill-decisions.schema.json) ----

export type GapDecision = 'declined' | 'unreachable' | 'kept-as-is';
// One gap the owner decided. Without a unit it covers every Unit of the file; without lines, every line of the Unit.
// blob is the file's git blob id when decided: once the file changes, the decision is stale and the gap is shown again.
export type DecidedGap = {
  package: Pkg;
  path: string;
  unit?: string;
  lines?: string;
  decision: GapDecision;
  reason: string;
  pr: number;
  blob: string;
};
export type BackfillDecisions = { decisions: DecidedGap[] };

// ---- checked.json ----

export type SummaryAgent = 'author' | 'reviewer';
// Per agent: backticked names in its summary that no Unit, test or file of the run contains (report-only).
export type UnknownNames = Record<SummaryAgent, string[]>;

export type Checked = {
  ok: boolean;
  errors: string[];
  dropFiles: string[]; // test files with a blocking finding, and new files holding a flagged Defect's failing test
  reviewRejected: string[]; // unitKey of units whose tests live in a file with a blocking finding (report-only state)
  unknownNames: UnknownNames;
};

// ---- results.json ----

export type Check = 'pass' | 'fail' | 'skipped';
export type CoverageFigures = { lines: number; branches: number };
export type Coverage = Record<string, Record<string, CoverageFigures>>;
export type SuiteResult = { status: Check; passed: number; failed: number };
export type Mutant = { file: string; line: number; mutator: string };
export type MutationResult = { score: number; survived: Mutant[] };
// A test file the Bot commit added or changed that failed in a shuffled rerun. `file` is a repo path.
export type FlakyFile = { file: string; tests: string[]; failedReruns: number; reruns: number };
export type Results = {
  typecheck: Record<string, Check>;
  tests: Record<string, SuiteResult>;
  flaky: FlakyFile[];
  coverage: { baseline: Coverage; final: Coverage };
  mutation: Record<string, MutationResult | null>;
};

// ---- context.json ----

export type JobResult = 'success' | 'failure' | 'cancelled' | 'skipped';
export type Job = 'scope' | 'agents' | 'bot_commit' | 'suites';
export type Context = {
  pr: number;
  analyzed_sha: string;
  final_sha: string;
  run_url: string;
  same_repo: boolean;
  label_skip: boolean;
  label_actor: string;
  run_agent: boolean;
  jobs: Record<Job, JobResult>;
};

// Everything one PR run produced; each artifact is missing if its job did not get that far.
export type Run = {
  context: Context;
  scope?: Scope;
  author?: AuthorOutput;
  reviewer?: ReviewerOutput;
  checked?: Checked;
  results?: Results;
};

// ---- Helpers ----

export type VerdictRule = {
  requires: readonly (keyof Unit)[]; // fields the schema marks optional but this verdict needs
  writesTests: boolean; // must list at least one test
  needsReview: boolean; // the reviewer must run when any unit has this verdict
};

export const VERDICT_RULES: Record<Verdict, VerdictRule> = {
  added: { requires: [], writesTests: true, needsReview: true },
  amended: { requires: [], writesTests: true, needsReview: true },
  'not-needed': { requires: ['reason'], writesTests: false, needsReview: false },
  'flagged-defect': { requires: ['defect'], writesTests: false, needsReview: true },
};

export const writesTests = (verdict: Verdict) => VERDICT_RULES[verdict].writesTests;
export const isFlaggedDefect = (unit: Unit) => unit.verdict === 'flagged-defect';

// A test checks one Expectation, so a Unit's tests are its Expectations' tests.
export const unitTests = (unit: Unit) => unit.expectations.flatMap((expectation) => expectation.tests);

// Tests are named `file > test name`; the name is the last part.
export const testName = (test: string) => test.split(' > ').at(-1) ?? test;

// A Characterization test says so in its name, so a reader of the test file knows no Intent source backs it.
export const CHARACTERIZATION_PREFIX = 'characterization: ';

// Unit names repeat across files (`initialize`, `default`), so a unit is identified by path and name together.
export const unitKey = (unit: { path: string; unit: string }) => `${unit.path}#${unit.unit}`;

// Coverage reports key files relative to their package folder, which is named after the package.
export const packageRelative = (candidate: Candidate) => candidate.path.slice(`${candidate.package}/`.length);
