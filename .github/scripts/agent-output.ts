// Validates both agents' output against their schemas and computes which test files to drop.
// Usage: node agent-output.ts <author.json> [--reviewer reviewer.json] [--patch tests.patch] [--max-attempts N] [--out checked.json]
// Exit 1 if anything is invalid; --out is written either way so `publish` can read it.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { CHARACTERIZATION_PREFIX, isFlaggedDefect, testName, unitKey, unitTests, VERDICT_RULES, writesTests } from './artifacts.ts';
import type { AuthorOutput, Checked, Kind, ReviewerOutput, Unit } from './artifacts.ts';
import { die, EXIT_CODES } from './cli.ts';
import { readJson, writeJson } from './json.ts';
import { readSchema, validate } from './schema.ts';
import { scanLines } from './scan.ts';
import type { LineRule } from './scan.ts';

type PatchFiles = { file: string; added: Map<string, string[]>; created: Set<string> };
type DefectTests = { errors: string[]; dropFiles: string[] };
type NameRule = { prefixed: boolean; must: string };

const SCRIPT = 'agent-output';

// ---- Rules the schema can't express ----

const testFile = (test: string) => test.split(' > ')[0];

function checkUnit(unit: Unit, maxAttempts: number): string[] {
  const name = `${unit.path} ${unit.unit}`;
  const rule = VERDICT_RULES[unit.verdict];
  const errors = rule.requires.filter((field) => unit[field] === undefined).map((field) => `${name}: ${unit.verdict} needs ${field}`);
  if (rule.writesTests && unitTests(unit).length === 0) errors.push(`${name}: ${unit.verdict} lists no tests`);
  if (unit.attempts < 0 || unit.attempts > maxAttempts) errors.push(`${name}: attempts ${unit.attempts} outside 0..${maxAttempts}`);
  return [...errors, ...checkTestKinds(unit)];
}

// The test name must say what its Expectation's kind says, so neither the file nor the report claims intent
// that no source states.
const NAME_RULES: Record<Kind, NameRule> = {
  intent: { prefixed: false, must: 'must not start with' },
  characterization: { prefixed: true, must: 'must start with' },
};

function checkTestKinds(unit: Unit): string[] {
  const name = `${unit.path} ${unit.unit}`;
  const tests = unitTests(unit);
  const repeated = new Set(tests.filter((test, index) => tests.indexOf(test) !== index));
  const errors = [...repeated].map((test) => `${name}: test "${test}" is listed under more than one Expectation`);
  for (const { kind, tests: listed } of unit.expectations) {
    const rule = NAME_RULES[kind];
    const wrong = listed.filter((test) => testName(test).startsWith(CHARACTERIZATION_PREFIX) !== rule.prefixed);
    errors.push(...wrong.map((test) => `${name}: test "${test}" checks an Expectation of kind ${kind}, so its name ${rule.must} "${CHARACTERIZATION_PREFIX}"`));
  }
  return errors;
}

function checkDuplicates(units: Unit[]): string[] {
  const keys = units.map(unitKey);
  const repeated = new Set(keys.filter((key, index) => keys.indexOf(key) !== index));
  return [...repeated].map((key) => `unit "${key}" is listed more than once`);
}

function checkFindings(units: Unit[], review: ReviewerOutput): string[] {
  const known = new Set(units.flatMap(unitTests));
  return review.findings.filter((f) => !known.has(f.test)).map((f) => `finding refers to unknown test "${f.test}"`);
}

function checkDefectDecisions(units: Unit[], review: ReviewerOutput): string[] {
  const flagged = new Set(units.filter(isFlaggedDefect).map(unitKey));
  const decided = new Set(review.defects.map(unitKey));
  const extra = [...decided].filter((key) => !flagged.has(key)).map((key) => `reviewer decides on "${key}", which is not a flagged-defect`);
  const undecided = [...flagged].filter((key) => !decided.has(key)).map((key) => `flagged-defect "${key}" has no reviewer decision`);
  return [...extra, ...undecided];
}

// Per file of the patch: the lines it adds, and whether the patch creates it. The `+++` header is not an added line.
const PATCH_LINES: readonly LineRule<PatchFiles>[] = [
  { pattern: /^diff --git a\/(.+) b\/\1$/, apply: (state, [, path]) => (state.file = path) },
  { pattern: /^new file mode/, apply: ({ file, created }) => created.add(file) },
  { pattern: /^\+\+\+ /, apply: () => {} },
  { pattern: /^\+(.*)$/, apply: ({ file, added }, [, line]) => added.set(file, [...(added.get(file) ?? []), line]) },
];

const patchFiles = (patch: string) =>
  scanLines(patch, PATCH_LINES, { file: '', added: new Map<string, string[]>(), created: new Set<string>() });

// A flagged Defect's test fails against the code, so it must not reach the Bot commit. A file the patch creates is
// dropped whole (prove-tests keeps such a test in a file of its own); in a file that existed, the Author must remove it.
function defectTests(units: Unit[], patch: string): DefectTests {
  const { added, created } = patchFiles(patch);
  const leftIn = (test: string) => {
    const name = testName(test);
    return (added.get(testFile(test)) ?? []).some((line) => line.includes(name));
  };
  const left = units.flatMap((unit) => (unit.defect ? [unit.defect.test] : [])).filter(leftIn);
  const inNewFile = (test: string) => created.has(testFile(test));
  return {
    errors: left.filter((test) => !inNewFile(test)).map((test) => `flagged Defect test "${test}" is still in an existing test file`),
    dropFiles: left.filter(inNewFile).map(testFile),
  };
}

function blockingFiles(review: ReviewerOutput | undefined): Set<string> {
  const blocking = (review?.findings ?? []).filter((f) => f.severity === 'blocking');
  return new Set(blocking.map((f) => testFile(f.test)));
}

const invalid = (errors: string[]): Checked => ({ ok: false, errors, dropFiles: [], reviewRejected: [] });

function check(author: unknown, reviewer: unknown, patch: string | undefined, maxAttempts: number): Checked {
  const schemaErrors = [
    ...validate(author, readSchema('./author.schema.json')).map((e) => `author ${e}`),
    ...(reviewer === undefined ? [] : validate(reviewer, readSchema('./reviewer.schema.json')).map((e) => `reviewer ${e}`)),
  ];
  if (schemaErrors.length) return invalid(schemaErrors);

  const { units } = author as AuthorOutput;
  const review = reviewer as ReviewerOutput | undefined;
  const reviewRequired = units.some((u) => VERDICT_RULES[u.verdict].needsReview);

  const defects: DefectTests = patch === undefined ? { errors: [], dropFiles: [] } : defectTests(units, patch);
  const errors = [
    ...checkDuplicates(units),
    ...units.flatMap((unit) => checkUnit(unit, maxAttempts)),
    ...(reviewRequired && !review ? ['reviewer.json is missing but the author produced tests or defects'] : []),
    ...(review ? [...checkFindings(units, review), ...checkDefectDecisions(units, review)] : []),
    ...defects.errors,
  ];
  if (errors.length) return invalid(errors);

  const blocking = blockingFiles(review);
  const reviewRejected = units
    .filter((u) => writesTests(u.verdict) && unitTests(u).some((t) => blocking.has(testFile(t))))
    .map(unitKey);
  return { ok: true, errors: [], dropFiles: [...new Set([...blocking, ...defects.dropFiles])], reviewRejected };
}

// ---- CLI ----

type Files = { author: string; reviewer?: string; patch?: string };

function checkFiles(files: Files, maxAttempts: number): Checked {
  try {
    const patch = files.patch === undefined ? undefined : readFileSync(files.patch, 'utf8');
    return check(readJson(files.author), files.reviewer ? readJson(files.reviewer) : undefined, patch, maxAttempts);
  } catch (error) {
    return invalid([(error as Error).message]);
  }
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { reviewer: { type: 'string' }, patch: { type: 'string' }, 'max-attempts': { type: 'string' }, out: { type: 'string' } },
  });
  const [file] = positionals;
  if (!file) {
    die(SCRIPT, 'usage: agent-output.ts <author.json> [--reviewer reviewer.json] [--patch tests.patch] [--max-attempts N] [--out checked.json]', 'usage');
  }

  const maxAttempts = Number(values['max-attempts'] ?? process.env.TEST_AGENT_MAX_ATTEMPTS);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) die(SCRIPT, 'pass --max-attempts N or set TEST_AGENT_MAX_ATTEMPTS', 'usage');

  const result = checkFiles({ author: file, reviewer: values.reviewer, patch: values.patch }, maxAttempts);

  if (values.out) writeJson(values.out, result);
  for (const error of result.errors) console.error(`${SCRIPT}: ${error}`);
  const list = (items: string[]) => items.join(', ') || 'none';
  console.log(`${SCRIPT}: ${result.ok ? 'ok' : 'INVALID'}; drop files: ${list(result.dropFiles)}; review-rejected: ${list(result.reviewRejected)}`);
  process.exit(result.ok ? 0 : EXIT_CODES.failed);
}

if (import.meta.main) main();
