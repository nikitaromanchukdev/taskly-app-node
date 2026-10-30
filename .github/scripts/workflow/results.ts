// suites job: turn the raw reports of both packages into results.json.
// Usage: node results.ts <dir> --final-tree <path> [--baseline-tree <path>] [--out results.json]
// <dir>/final/ (and <dir>/baseline/ when a bot commit exists) hold, per package written by verify.sh:
//   <pkg>.typecheck (pass|fail) · <pkg>.vitest.json (vitest json reporter) · <pkg>.coverage.json (json-summary)
//   <pkg>.mutation.json (Stryker json report, final only, missing when not run)
//   <pkg>.rerun.files and <pkg>.rerun.<n>.json (shuffled reruns of the Bot commit's tests, final only; see flaky.ts)
// and once: scripts.tap (node --test TAP report of the workflow's own scripts)
// A missing report counts as a failure; a missing baseline falls back to the final coverage.
// The reports come from a job that ran PR code, so they are untrusted: every value taken from them is coerced to a
// number or a known label here, and results.json can only make the status worse (status.ts needs the suites job result).
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import type { Check, Coverage, CoverageFigures, MutationResult, Results, SuiteResult } from '../lib/artifacts.ts';
import { die } from '../lib/cli.ts';
import { readJson, readJsonIfExists, writeJson } from '../lib/json.ts';
import { flakyFiles } from './flaky.ts';
import { PACKAGES } from '../contracts/rules.ts';
import type { Pkg } from '../contracts/rules.ts';

type Phase = 'baseline' | 'final';
type MutantStatus = 'Killed' | 'Timeout' | 'Survived' | 'NoCoverage' | 'Ignored' | 'CompileError' | 'RuntimeError' | 'Pending';
type MutantOutcome = 'detected' | 'undetected' | 'invalid';

type VitestReport = { success?: boolean; numPassedTests?: number; numFailedTests?: number; numFailedTestSuites?: number };
type SummaryEntry = { lines?: { pct?: number | string }; branches?: { pct?: number | string } };
type StrykerMutant = { mutatorName: string; status: MutantStatus; location: { start: { line: number } } };
type StrykerReport = { files: Record<string, { mutants: StrykerMutant[] }> };

const SCRIPT = 'results';

// ---- Typecheck and tests ----

// A count from a report: a finite non-negative number, else 0.
const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0);

const CHECKS: Record<string, Check> = { pass: 'pass', fail: 'fail' };

function typecheck(dir: string, pkg: Pkg): Check {
  const file = join(dir, `${pkg}.typecheck`);
  return existsSync(file) ? (CHECKS[readFileSync(file, 'utf8').trim()] ?? 'fail') : 'fail';
}

function suite(dir: string, pkg: Pkg): SuiteResult {
  const report = readJsonIfExists<VitestReport>(join(dir, `${pkg}.vitest.json`));
  if (!report) return { status: 'fail', passed: 0, failed: 0 };
  const failed = count(report.numFailedTests);
  const ok = report.success === true && failed === 0 && count(report.numFailedTestSuites) === 0;
  return { status: ok ? 'pass' : 'fail', passed: count(report.numPassedTests), failed };
}

// The workflow's own scripts. TAP ends with "# pass N" and "# fail N"; a run with no passing test fails too.
function scriptsSuite(dir: string): SuiteResult {
  const file = join(dir, 'scripts.tap');
  if (!existsSync(file)) return { status: 'fail', passed: 0, failed: 0 };
  const tap = readFileSync(file, 'utf8');
  const tapCount = (name: string) => Number(new RegExp(`^# ${name} (\\d+)$`, 'm').exec(tap)?.[1] ?? 0);
  const passed = tapCount('pass');
  const failed = tapCount('fail') + tapCount('cancelled');
  return { status: passed > 0 && failed === 0 ? 'pass' : 'fail', passed, failed };
}

// ---- Coverage ----

const pct = (value: number | string | undefined) => (typeof value === 'number' ? value : 0);

// Coverage keys are absolute paths; report them relative to the package folder, like packageRelative().
function coverage(dir: string, tree: string, pkg: Pkg): Record<string, CoverageFigures> {
  const summary = readJsonIfExists<Record<string, SummaryEntry>>(join(dir, `${pkg}.coverage.json`)) ?? {};
  const files = Object.entries(summary).filter(([key]) => key !== 'total');
  return Object.fromEntries(
    files.map(([file, entry]) => [relative(join(tree, pkg), file), { lines: pct(entry.lines?.pct), branches: pct(entry.branches?.pct) }]),
  );
}

function coverageOf(dir: string, tree: string): Coverage {
  return Object.fromEntries(PACKAGES.map((pkg) => [pkg, coverage(dir, tree, pkg)]));
}

// ---- Mutation ----

const OUTCOMES: Record<MutantStatus, MutantOutcome> = {
  Killed: 'detected',
  Timeout: 'detected',
  Survived: 'undetected',
  NoCoverage: 'undetected',
  Ignored: 'invalid',
  CompileError: 'invalid',
  RuntimeError: 'invalid',
  Pending: 'invalid',
};

const repoPath = (pkg: Pkg, tree: string, file: string) => `${pkg}/${file.startsWith('/') ? relative(join(tree, pkg), file) : file}`;

function mutation(dir: string, tree: string, pkg: Pkg): MutationResult | null {
  const report = readJsonIfExists<StrykerReport>(join(dir, `${pkg}.mutation.json`));
  if (!report) return null;
  const mutants = Object.entries(report.files).flatMap(([file, entry]) => entry.mutants.map((mutant) => ({ file, mutant })));
  const outcome = ({ mutant }: { mutant: StrykerMutant }) => OUTCOMES[mutant.status] ?? 'invalid';
  const detected = mutants.filter((m) => outcome(m) === 'detected').length;
  const survived = mutants.filter((m) => outcome(m) === 'undetected');
  if (detected + survived.length === 0) return null;
  return {
    score: Math.round((1000 * detected) / (detected + survived.length)) / 10,
    survived: survived.map(({ file, mutant }) => ({
      file: repoPath(pkg, tree, file),
      line: mutant.location.start.line,
      mutator: mutant.mutatorName,
    })),
  };
}

// ---- Main ----

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { 'final-tree': { type: 'string' }, 'baseline-tree': { type: 'string' }, out: { type: 'string', default: 'results.json' } },
  });
  const [dir] = positionals;
  const finalTree = values['final-tree'];
  if (!dir || !finalTree) die(SCRIPT, 'usage: results.ts <dir> --final-tree <path> [--baseline-tree <path>] [--out results.json]', 'usage');

  const finalDir = join(dir, 'final');
  const final = coverageOf(finalDir, finalTree);
  const baselineDir = join(dir, 'baseline');
  const baseline = values['baseline-tree'] && existsSync(baselineDir) ? coverageOf(baselineDir, values['baseline-tree']) : final;

  const results: Results = {
    typecheck: Object.fromEntries(PACKAGES.map((pkg) => [pkg, typecheck(finalDir, pkg)])),
    tests: { ...Object.fromEntries(PACKAGES.map((pkg) => [pkg, suite(finalDir, pkg)])), scripts: scriptsSuite(finalDir) },
    flaky: PACKAGES.flatMap((pkg) => flakyFiles(finalDir, finalTree, pkg)),
    coverage: { baseline, final },
    mutation: Object.fromEntries(PACKAGES.map((pkg) => [pkg, mutation(finalDir, finalTree, pkg)])),
  };
  writeJson(values.out, results);
  console.log(`${SCRIPT}: ${PACKAGES.map((pkg) => `${pkg} typecheck ${results.typecheck[pkg]}, tests ${results.tests[pkg].status}`).join('; ')}; scripts tests ${results.tests.scripts.status} → ${values.out}`);
}

if (import.meta.main) main();
