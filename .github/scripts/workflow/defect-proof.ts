// Proves flagged Defects: a Defect is proven when its test fails with an assertion that names the Author's values.
// Usage:
//   node defect-proof.ts build <author.json> --patch <tests.patch> --out-dir <dir>     (bot_commit, no PR code)
//   node defect-proof.ts decide <defects.json> --reports <dir> [--out proof.json]       (publish, no PR code)
// build writes <dir>/defects.patch (the new test files that hold a flagged Defect's test, as the Author wrote them) and
// <dir>/defects.json (one DefectCase each), and nothing when no Defect has its test in a new file of the patch. agent-output.ts keeps
// those files out of the Bot commit; the suites job applies defects.patch to a copy of the final tree and runs them.
// decide reads <dir>/<package>.defects.json (the vitest JSON report of that run, written by PR code, so untrusted) and
// writes a Proof per DefectCase. A Proof carries a fixed label, never report text, because it reaches the PR comment.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { isFlaggedDefect, namedIn, testName } from '../lib/artifacts.ts';
import type { AuthorOutput, DefectCase, Proof } from '../lib/artifacts.ts';
import { die } from '../lib/cli.ts';
import { readJson, writeJson } from '../lib/json.ts';
import { PACKAGES } from '../contracts/rules.ts';
import type { Pkg } from '../contracts/rules.ts';

type Judgement = Pick<Proof, 'state' | 'reason'>;
type FailureRule = { pattern: RegExp; reason: string };
type TestResult = { title?: unknown; fullName?: unknown; status?: unknown; failureMessages?: unknown };
type FileReport = { name?: unknown; assertionResults?: unknown };

const SCRIPT = 'defect-proof';
const MAX_FAILURE_TEXT = 4000;

const proven = (): Judgement => ({ state: 'proven', reason: '' });
const unproven = (reason: string): Judgement => ({ state: 'unproven', reason });

// ---- build ----

const testFile = (test: string) => test.split(' > ')[0];
const packageOf = (file: string) => PACKAGES.find((pkg) => file.startsWith(`${pkg}/`));

// The patch split into one block per file, by the path in its `diff --git` header.
function patchBlocks(patch: string): Map<string, string> {
  const blocks = new Map<string, string>();
  for (const block of patch.split(/^(?=diff --git )/m)) {
    const path = /^diff --git a\/(.+) b\/\1$/m.exec(block)?.[1];
    if (path && /^new file mode/m.test(block)) blocks.set(path, block);
  }
  return blocks;
}

// The lines a file's block adds, without the `+`.
const addedLines = (block: string) => block.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++')).map((line) => line.slice(1));

// A flagged Defect's test lives in a new file (agent-output.ts rejects one in an existing file), and agent-output.ts drops
// that whole file from the Bot commit. So the Defect patch is the file as the Author wrote it: it does not exist in the
// final tree, any passing tests in it run too, and only the named test is judged. A file that does not hold the named
// test (the Author removed it) is not a Defect file: it stays in the Bot commit, and agent-output.ts reports the missing test.
export function buildDefects(author: AuthorOutput, patch: string): { cases: DefectCase[]; patch: string } {
  const blocks = patchBlocks(patch);
  const cases = author.units.flatMap((unit): DefectCase[] => {
    if (!isFlaggedDefect(unit) || !unit.defect) return [];
    const file = testFile(unit.defect.test);
    const pkg = packageOf(file);
    const block = blocks.get(file);
    if (!pkg || block === undefined || !namedIn(addedLines(block), unit.defect.test)) return [];
    const { expected, received, test } = unit.defect;
    return [{ package: pkg, path: unit.path, unit: unit.unit, file, packageFile: file.slice(pkg.length + 1), test: testName(test), expected, received }];
  });
  const files = [...new Set(cases.map((c) => c.file))];
  return { cases, patch: files.map((file) => blocks.get(file)).join('') };
}

// ---- decide ----

// Replace quote characters and runs of white space, and lower-case, so `"abc"` and 'abc' match.
const normalize = (text: string) =>
  text
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/[‘’“”"`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

// First line of a failure that says it is not an assertion. Checked in order; the first match names the reason.
const NOT_ASSERTIONS: readonly FailureRule[] = [
  { pattern: /timed out/i, reason: 'the test timed out' },
  { pattern: /^TypeError\b/, reason: 'the test failed with a TypeError' },
  { pattern: /^ReferenceError\b/, reason: 'the test failed with a ReferenceError' },
  { pattern: /^SyntaxError\b/, reason: 'the test failed with a SyntaxError' },
  { pattern: /^RangeError\b/, reason: 'the test failed with a RangeError' },
  { pattern: /failed to (?:resolve|load)|cannot find (?:module|package)|error loading|transform failed/i, reason: 'the test file could not be loaded' },
];
const ASSERTION_START = /^(?:AssertionError\b|expected\b)/i;

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

// The first message decides what kind of failure it is; every message is searched for the values.
function judgeFailure(messages: string[], expected: string, received: string): Judgement {
  if (messages.length === 0) return unproven('the test failed without a message');
  const lines = messages.map((message) => message.replace(/\u001b\[[0-9;]*m/g, '').trimStart().split('\n')[0]);
  const notAssertion = NOT_ASSERTIONS.find((rule) => lines.some((line) => rule.pattern.test(line)));
  if (notAssertion) return unproven(notAssertion.reason);
  if (!lines.some((line) => ASSERTION_START.test(line))) return unproven('the test failed with an error that is not an assertion');
  const text = normalize(messages.join('\n').slice(0, MAX_FAILURE_TEXT));
  const states = [expected, received].map((value) => text.includes(normalize(value)));
  return states.every(Boolean) ? proven() : unproven("the assertion does not show the Author's expected and received values");
}

const MATCH_NAMES: readonly ((result: TestResult, name: string) => boolean)[] = [
  (result, name) => result.title === name,
  (result, name) => result.fullName === name,
];

// The report's result for the case's test: in a file whose path ends with the case's file, with its name.
function resultOf(report: unknown, found: DefectCase): TestResult | undefined {
  const files = typeof report === 'object' && report !== null && Array.isArray((report as { testResults?: unknown }).testResults)
    ? ((report as { testResults: FileReport[] }).testResults)
    : [];
  const matches = files
    .filter((file) => typeof file === 'object' && file !== null && typeof file.name === 'string' && file.name.endsWith(`/${found.packageFile}`))
    .flatMap((file) => (Array.isArray(file.assertionResults) ? (file.assertionResults as TestResult[]) : []))
    .filter((result) => typeof result === 'object' && result !== null && MATCH_NAMES.some((match) => match(result, found.test)));
  return matches.find((result) => result.status === 'failed') ?? matches[0];
}

const STATUS_REASONS: Record<string, string> = {
  passed: 'the test passed',
  pending: 'the test did not run',
  skipped: 'the test did not run',
  todo: 'the test did not run',
  disabled: 'the test did not run',
};

export function judge(report: unknown, found: DefectCase): Judgement {
  if (report === undefined) return unproven('no report of the Defect test run');
  const result = resultOf(report, found);
  if (!result) return unproven('the test is not in the report');
  if (result.status !== 'failed') return unproven(STATUS_REASONS[String(result.status)] ?? 'the test did not fail');
  return judgeFailure(strings(result.failureMessages), found.expected, found.received);
}

export function decideProofs(cases: DefectCase[], reportOf: (pkg: Pkg) => unknown): Proof[] {
  return cases.map((found) => ({ path: found.path, unit: found.unit, ...judge(reportOf(found.package), found) }));
}

// ---- CLI ----

function readReport(dir: string, pkg: Pkg): unknown {
  const file = join(dir, `${pkg}.defects.json`);
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
  } catch {
    return undefined;
  }
}

function build(args: string[]) {
  const { values, positionals } = parseArgs({ allowPositionals: true, args, options: { patch: { type: 'string' }, 'out-dir': { type: 'string' } } });
  const [file] = positionals;
  if (!file || !values.patch || !values['out-dir']) die(SCRIPT, 'usage: defect-proof.ts build <author.json> --patch <tests.patch> --out-dir <dir>', 'usage');
  const { cases, patch } = buildDefects(readJson<AuthorOutput>(file), readFileSync(values.patch, 'utf8'));
  if (cases.length === 0) return console.log(`${SCRIPT}: no flagged Defect has its test in a new file of the patch`);
  mkdirSync(values['out-dir'], { recursive: true });
  writeFileSync(join(values['out-dir'], 'defects.patch'), patch);
  writeJson(join(values['out-dir'], 'defects.json'), cases);
  console.log(`${SCRIPT}: ${cases.length} Defect test(s) in ${new Set(cases.map((c) => c.file)).size} file(s) → ${values['out-dir']}`);
}

function decide(args: string[]) {
  const { values, positionals } = parseArgs({ allowPositionals: true, args, options: { reports: { type: 'string' }, out: { type: 'string', default: 'proof.json' } } });
  const [file] = positionals;
  if (!file || !values.reports) die(SCRIPT, 'usage: defect-proof.ts decide <defects.json> --reports <dir> [--out proof.json]', 'usage');
  const proofs = decideProofs(readJson<DefectCase[]>(file), (pkg) => readReport(values.reports as string, pkg));
  writeJson(values.out, proofs);
  for (const proof of proofs) console.log(`${SCRIPT}: ${proof.path} ${proof.unit}: ${proof.state}${proof.reason ? ` (${proof.reason})` : ''}`);
}

const COMMANDS: Record<string, (args: string[]) => void> = { build, decide };

function main() {
  const [command, ...args] = process.argv.slice(2);
  const run = COMMANDS[command ?? ''];
  if (!run) die(SCRIPT, 'usage: defect-proof.ts <build|decide> ...', 'usage');
  run(args);
}

if (import.meta.main) main();
