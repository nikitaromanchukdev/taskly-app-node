// Validates both agents' output against their schemas and the checkout, and computes which test files to drop.
// Usage: node agent-output.ts <author.json> [--reviewer reviewer.json] [--patch tests.patch] [--root DIR] [--max-attempts N] [--out checked.json]
// --root is the checkout of the analyzed head (default: ./head when it exists, else the current folder); the patch adds
// the Author's new files to it.
// Exit 1 if anything is invalid; --out is written either way so `publish` can read it.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { CHARACTERIZATION_PREFIX, isFlaggedDefect, namedIn, testName, unitKey, unitTests, VERDICT_RULES, writesTests } from '../lib/artifacts.ts';
import type { AuthorOutput, Checked, Kind, ReviewerOutput, Unit, UnknownNames } from '../lib/artifacts.ts';
import { die, EXIT_CODES } from '../lib/cli.ts';
import { readJson, writeJson } from '../lib/json.ts';
import { readSchema, validate } from '../lib/schema.ts';
import { scanLines } from '../lib/scan.ts';
import type { LineRule } from '../lib/scan.ts';

type PatchFiles = { file: string; added: Map<string, string[]>; created: Set<string> };
type DefectTests = { errors: string[]; dropFiles: string[]; missing: string[] };
type NameRule = { prefixed: boolean; must: string };
type Checkout = { root: string; patch: PatchFiles };
// What a summary may name: the text of the Units' files and test files as the Bot commit leaves them, by path.
type Known = { files: Map<string, string> };
type Inputs = { author: unknown; reviewer: unknown; patch: string | undefined; root: string; maxAttempts: number };

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

const inPatch = (test: string, { added }: PatchFiles) => namedIn(added.get(testFile(test)) ?? [], test);

// A flagged Defect's test fails against the code, so it must not reach the Bot commit. A file the patch creates is
// dropped whole (prove-tests keeps such a test in a file of its own); in a file that existed, the Author must remove it.
// A test that is in no file of the patch was removed instead of moved: it is reported, not an error.
function defectTests(units: Unit[], files: PatchFiles): DefectTests {
  const { created } = files;
  const withTest = units.flatMap((unit) => (unit.defect ? [{ key: unitKey(unit), test: unit.defect.test }] : []));
  const left = withTest.map(({ test }) => test).filter((test) => inPatch(test, files));
  const inNewFile = (test: string) => created.has(testFile(test));
  return {
    missing: withTest.filter(({ test }) => !inPatch(test, files)).map(({ key }) => key),
    errors: left.filter((test) => !inNewFile(test)).map((test) => `flagged Defect test "${test}" is still in an existing test file`),
    dropFiles: left.filter(inNewFile).map(testFile),
  };
}

function blockingFiles(review: ReviewerOutput | undefined): Set<string> {
  const blocking = (review?.findings ?? []).filter((f) => f.severity === 'blocking');
  return new Set(blocking.map((f) => testFile(f.test)));
}

// ---- Names and files the output gives must exist in the checkout ----

// A path the output gives, resolved inside the checkout; a path that leaves it names nothing.
function local({ root }: Checkout, path: string): string | undefined {
  const full = resolve(root, path);
  return full.startsWith(root + sep) ? full : undefined;
}

const onDisk = (checkout: Checkout, path: string) => {
  const full = local(checkout, path);
  return full !== undefined && existsSync(full);
};

const exists = (checkout: Checkout, path: string) => checkout.patch.created.has(path) || onDisk(checkout, path);

// The file as the Bot commit leaves it: its text in the checkout, plus the lines the patch adds.
function fileText(checkout: Checkout, path: string): string {
  const full = local(checkout, path);
  const disk = full !== undefined && existsSync(full) && statSync(full).isFile() ? readFileSync(full, 'utf8') : '';
  return [disk, ...(checkout.patch.added.get(path) ?? [])].join('\n');
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = (name: string, flags = '') => new RegExp(`(?<![\\w$])${escapeRegExp(name)}(?![\\w$])`, flags);
const identifiers = (text: string) => text.match(/[A-Za-z_$][\w$]*/g) ?? [];

// Each identifier of a Unit's name (`TodoRepository.stats`, `default`, `GET /todos/:id`) must appear in its file.
// Case is ignored, because a route's method is `GET` in its name and `router.get` in the code.
function checkUnitName(unit: Unit, checkout: Checkout): string[] {
  const name = `${unit.path} ${unit.unit}`;
  if (!exists(checkout, unit.path)) return [`${name}: ${unit.path} is not in the checkout`];
  const text = fileText(checkout, unit.path);
  const missing = identifiers(unit.unit).filter((id) => !word(id, 'i').test(text));
  return missing.length ? [`${name}: ${missing.join(', ')} does not appear in ${unit.path}`] : [];
}

const testFiles = (units: Unit[]) => [
  ...new Set(units.flatMap((unit) => [...unitTests(unit), ...(unit.defect ? [unit.defect.test] : [])]).map(testFile)),
];

// A test is `file > name` with the file's path from the repo root; a bare file name matches nothing in the patch.
const checkTestFiles = (units: Unit[], checkout: Checkout) =>
  testFiles(units)
    .filter((file) => !exists(checkout, file))
    .map((file) => `test file "${file}" is in neither the checkout nor the patch; give its path from the repo root`);

// Backticked text shaped like a path or a code name is checked. Anything else (`true`, `404`, `--flag`, `a < b`) is a literal.
const NAME_SHAPES: readonly RegExp[] = [
  /^[\w.@-]+\/[\w.@/:-]*$/, // a path: `backend/src/todos.ts`, `backend/src/todos.ts:12`
  /^[\w.-]+\.(?:[cm]?[jt]sx?|json|md|ya?ml|css|html)$/, // a file name
  /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+(?:\(.*\))?$/, // qualified: `Class.method`, `Class.method()`
  /^[A-Za-z_$][\w$]*\(.*\)$/, // a call: `name()`, `name(arg)`
  /^[a-z_$][\w$]*[A-Z][\w$]*$/, // camelCase
  /^[A-Z][a-z\d]+[A-Z][\w$]*$/, // PascalCase of two or more words
];

const summarySpans = (summary: string) => [
  ...new Set(
    [...summary.replace(/```[\s\S]*?```/g, '').matchAll(/(?<!`)`([^`\n]+)`(?!`)/g)]
      .map(([, span]) => span.trim())
      .filter((span) => NAME_SHAPES.some((shape) => shape.test(span))),
  ),
];

// A path in the checkout or the patch (a line suffix is allowed), or the file name of a Unit or test file.
function knownPath(span: string, known: Known, checkout: Checkout): boolean {
  const path = span.replace(/:\d+(?:-\d+)?$/, '').replace(/\/$/, '');
  return exists(checkout, path) || [...known.files.keys()].some((file) => basename(file) === path);
}

// `JSON.stringify`, `RangeError`: a built-in of the runtime, walked part by part.
function isBuiltIn(parts: readonly string[]): boolean {
  let value: unknown = globalThis;
  for (const part of parts) {
    if ((typeof value !== 'object' && typeof value !== 'function') || value === null || !(part in value)) return false;
    value = (value as Record<string, unknown>)[part];
  }
  return true;
}

// `Class.method` whose class is declared in a Unit or test file, and whose members appear in that file.
// An invented qualifier (`TodoStore.stats()` for the Unit `TodoRepository.stats`) is declared in none of them.
function isMember([head, ...members]: readonly string[], known: Known): boolean {
  const declares = new RegExp(`\\b(?:class|interface|type|enum|function|const|let|var|namespace)\\s+${escapeRegExp(head)}(?![\\w$])`);
  const owners = [...known.files.values()].filter((text) => declares.test(text));
  return members.length > 0 && owners.some((text) => members.every((member) => word(member).test(text)));
}

// Text found as it is in a Unit or test file, a built-in, or a member of a declared class.
// A call's arguments are dropped: `truncate('abc', 2)` names `truncate`.
function knownName(span: string, known: Known): boolean {
  const name = span.replace(/\(.*\)$/, '');
  const parts = name.split('.');
  return [...known.files.values()].some((text) => word(name).test(text)) || isBuiltIn(parts) || isMember(parts, known);
}

const unknownNames = (summary: string, known: Known, checkout: Checkout) =>
  summarySpans(summary).filter((span) => !knownPath(span, known, checkout) && !knownName(span, known));

function knownFiles(units: Unit[], checkout: Checkout): Known {
  const paths = [...new Set([...units.map((unit) => unit.path), ...testFiles(units)])];
  return { files: new Map(paths.map((path) => [path, fileText(checkout, path)])) };
}

const NO_UNKNOWN_NAMES: UnknownNames = { author: [], reviewer: [] };

const invalid = (errors: string[]): Checked => ({ ok: false, errors, dropFiles: [], reviewRejected: [], missingDefectTests: [], unknownNames: NO_UNKNOWN_NAMES });

function check({ author, reviewer, patch, root, maxAttempts }: Inputs): Checked {
  const schemaErrors = [
    ...validate(author, readSchema('../contracts/author.schema.json')).map((e) => `author ${e}`),
    ...(reviewer === undefined ? [] : validate(reviewer, readSchema('../contracts/reviewer.schema.json')).map((e) => `reviewer ${e}`)),
  ];
  if (schemaErrors.length) return invalid(schemaErrors);

  const { summary, units } = author as AuthorOutput;
  const review = reviewer as ReviewerOutput | undefined;
  const reviewRequired = units.some((u) => VERDICT_RULES[u.verdict].needsReview);

  const checkout: Checkout = { root, patch: patchFiles(patch ?? '') };
  const defects = defectTests(units, checkout.patch);
  const errors = [
    ...checkDuplicates(units),
    ...units.flatMap((unit) => [...checkUnit(unit, maxAttempts), ...checkUnitName(unit, checkout)]),
    ...checkTestFiles(units, checkout),
    ...(reviewRequired && !review ? ['reviewer.json is missing but the author produced tests or defects'] : []),
    ...(review ? [...checkFindings(units, review), ...checkDefectDecisions(units, review)] : []),
    ...defects.errors,
  ];
  if (errors.length) return invalid(errors);

  const blocking = blockingFiles(review);
  const reviewRejected = units
    .filter((u) => writesTests(u.verdict) && unitTests(u).some((t) => blocking.has(testFile(t))))
    .map(unitKey);
  // A summary is prose for the PR comment, not data. A name in it that drifted is shown in the report, not made invalid:
  // invalid output stops the Bot commit and turns the status red, and an agent's wording must not block the developer (ADR 0003).
  const known = knownFiles(units, checkout);
  const unknown: UnknownNames = {
    author: unknownNames(summary, known, checkout),
    reviewer: review ? unknownNames(review.summary, known, checkout) : [],
  };
  return { ok: true, errors: [], dropFiles: [...new Set([...blocking, ...defects.dropFiles])], reviewRejected, missingDefectTests: defects.missing, unknownNames: unknown };
}

// ---- CLI ----

type Files = { author: string; reviewer?: string; patch?: string };

function checkFiles(files: Files, root: string, maxAttempts: number): Checked {
  try {
    const patch = files.patch === undefined ? undefined : readFileSync(files.patch, 'utf8');
    const reviewer = files.reviewer ? readJson(files.reviewer) : undefined;
    return check({ author: readJson(files.author), reviewer, patch, root, maxAttempts });
  } catch (error) {
    return invalid([(error as Error).message]);
  }
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      reviewer: { type: 'string' },
      patch: { type: 'string' },
      root: { type: 'string' },
      'max-attempts': { type: 'string' },
      out: { type: 'string' },
    },
  });
  const [file] = positionals;
  if (!file) {
    die(SCRIPT, 'usage: agent-output.ts <author.json> [--reviewer reviewer.json] [--patch tests.patch] [--root DIR] [--max-attempts N] [--out checked.json]', 'usage');
  }

  const maxAttempts = Number(values['max-attempts'] ?? process.env.TEST_AGENT_MAX_ATTEMPTS);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) die(SCRIPT, 'pass --max-attempts N or set TEST_AGENT_MAX_ATTEMPTS', 'usage');

  const files = { author: file, reviewer: values.reviewer, patch: values.patch };
  const result = checkFiles(files, resolve(values.root ?? '.'), maxAttempts);

  if (values.out) writeJson(values.out, result);
  for (const error of result.errors) console.error(`${SCRIPT}: ${error}`);
  const warnings = Object.entries(result.unknownNames).flatMap(([agent, names]) =>
    names.map((name) => `${SCRIPT}: warning: ${agent} summary names \`${name}\`, which no Unit, test or file of this run contains`),
  );
  for (const warning of warnings) console.error(warning);
  const list = (items: string[]) => items.join(', ') || 'none';
  console.log(`${SCRIPT}: ${result.ok ? 'ok' : 'INVALID'}; drop files: ${list(result.dropFiles)}; review-rejected: ${list(result.reviewRejected)}; missing Defect tests: ${list(result.missingDefectTests)}`);
  process.exit(result.ok ? 0 : EXIT_CODES.failed);
}

if (import.meta.main) main();
