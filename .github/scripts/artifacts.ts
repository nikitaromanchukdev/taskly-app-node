// The files one PR run passes between jobs, and small pure helpers over them.
// scope.json (prepare) · author.json, reviewer.json (engineer) · checked.json (commit) · results.json (verify) · context.json (publish)
import type { Pkg, SkipReason } from './rules.ts';

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

export type Expectation = { text: string; source: string };
export type Defect = { test: string; expected: string; received: string; source: string };
export type Unit = {
  path: string;
  unit: string;
  verdict: Verdict;
  reason?: string;
  kind: Kind;
  expectations: Expectation[];
  tests: string[];
  attempts: number;
  defect?: Defect;
};
export type AuthorOutput = { summary: string; units: Unit[] };

export type Finding = { test: string; severity: Severity; reason: string; note: string };
export type DefectReview = { path: string; unit: string; decision: DefectDecision; source_quote: string };
export type ReviewerOutput = { summary: string; findings: Finding[]; defects: DefectReview[] };

// ---- checked.json ----

export type Checked = {
  ok: boolean;
  errors: string[];
  dropFiles: string[]; // test files with a blocking finding, and new files holding a flagged Defect's failing test
  reviewRejected: string[]; // unitKey of units whose tests live in a file with a blocking finding (report-only state)
};

// ---- results.json ----

export type Check = 'pass' | 'fail' | 'skipped';
export type CoverageFigures = { lines: number; branches: number };
export type Coverage = Record<string, Record<string, CoverageFigures>>;
export type SuiteResult = { status: Check; passed: number; failed: number };
export type Mutant = { file: string; line: number; mutator: string };
export type MutationResult = { score: number; survived: Mutant[] };
export type Results = {
  typecheck: Record<string, Check>;
  tests: Record<string, SuiteResult>;
  coverage: { baseline: Coverage; final: Coverage };
  mutation: Record<string, MutationResult | null>;
};

// ---- context.json ----

export type JobResult = 'success' | 'failure' | 'cancelled' | 'skipped';
export type Job = 'prepare' | 'engineer' | 'commit' | 'verify';
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

// Unit names repeat across files (`initialize`, `default`), so a unit is identified by path and name together.
export const unitKey = (unit: { path: string; unit: string }) => `${unit.path}#${unit.unit}`;

// Coverage reports key files relative to their package folder, which is named after the package.
export const packageRelative = (candidate: Candidate) => candidate.path.slice(`${candidate.package}/`.length);
