// Local trial helpers for the Makefile: the per-branch output folder, the intended behaviour, and cleanup.
// Usage: node trial.ts dir                         print the output folder of the current branch
//        node trial.ts intent --out <dir> --base <branch>
//                                                   make sure <dir>/pr-body.md exists; ask where it comes from
//        node trial.ts clean [--out <dir>]          clean <dir>, else the current branch's folder, or pick one
//        node trial.ts check --out <dir> --expected <file>
//                                                   compare a run with the outcome the demo expects
//        node trial.ts approve --out <dir> --package <p> [--items <1,3|all|none>] [--decline <2,4> --reason <text>]
//                                                   Backfill: render <dir>/gaps.json as gaps.md without the gaps
//                                                   decided earlier, then write the Recommendations the owner
//                                                   approves to <dir>/approved.json and declines to declined.json
//        node trial.ts record --out <dir> --package <p> --pr <n>
//                                                   Backfill: add <dir>/declined.json and the not-needed Units of
//                                                   <dir>/author.json to docs/backfill-decisions.json
//        node trial.ts decide --package <p> --path <file> [--unit <name>] [--lines <18, 20-22>]
//                             --decision <declined|unreachable|kept-as-is> --reason <text> --pr <n>
//                                                   Backfill: add or replace one decision in the record
// record and decide take --decisions <file> to use another record than docs/backfill-decisions.json.
// Questions are asked only on a terminal. Without one, intent takes the first source found, clean lists folders,
// and approve without --items only renders gaps.md.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import type {
  AuthorOutput,
  BackfillDecisions,
  Checked,
  DecidedGap,
  DeclinedGap,
  DefectDecision,
  GapDecision,
  Gaps,
  NotNeededReason,
  Recommendation,
  ReviewerOutput,
  Severity,
  UnreachableGap,
  Verdict,
} from '../lib/artifacts.ts';
import { unitKey } from '../lib/artifacts.ts';
import { plural } from '../workflow/status.ts';
import { die } from '../lib/cli.ts';
import { readJson, readJsonIfExists, writeJson } from '../lib/json.ts';
import { readSchema, validate } from '../lib/schema.ts';
import type { Pkg } from '../contracts/rules.ts';
import { PACKAGES } from '../contracts/rules.ts';

type Command = 'dir' | 'intent' | 'clean' | 'check' | 'approve' | 'record' | 'decide';
type SourceId = 'pr' | 'commits' | 'type' | 'editor' | 'skip';
type Source = { id: SourceId; label: string; text?: string };
type UnitRef = { path: string; unit: string };
type ExpectedFinding = { test: string; severity: Severity; reason: string };
// What a demo run must produce; a case lists only what it checks. dropFiles, when given, must match exactly.
type Expected = {
  units?: (UnitRef & { verdict: Verdict })[];
  defects?: (UnitRef & { decision: DefectDecision })[];
  findings?: ExpectedFinding[];
  dropFiles?: string[];
};

const SCRIPT = 'trial.ts';
const ROOT = '.test-agent';
const PR_BODY = 'pr-body.md';
const APPROVED = 'approved.json';
const DECLINED = 'declined.json';
// Kept by clean: the person's input, not run output.
const KEPT = new Set([PR_BODY, APPROVED, DECLINED]);
const NO_INTENT_WARNING =
  'trial: no intent given. Defects can only come from openapi.json, existing tests or docs; the rest becomes Characterization tests.';

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();

// A branch name may hold '/', which would nest folders; detached HEAD gets the short SHA.
function branchFolder(): string {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  const name = branch === 'HEAD' ? `detached-${git('rev-parse', '--short', 'HEAD')}` : branch;
  return join(ROOT, name.replaceAll('/', '-'));
}

// The open PR's title and body, as CI would read them. Missing gh, no login or no PR all mean none.
function openPrDescription(): string | undefined {
  const result = spawnSync('gh', ['pr', 'view', '--json', 'title,body', '--jq', '"## " + .title + "\\n\\n" + .body'], { encoding: 'utf8' });
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : undefined;
}

function commitMessages(base: string): string | undefined {
  const result = spawnSync('git', ['log', `${base}..HEAD`, '--format=%B'], { encoding: 'utf8' });
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : undefined;
}

// Person-written sources only, in the order CI would prefer them. Never text generated from the code:
// a summary of the code states what it does, so a Defect could never contradict it (ADR 0003).
function foundSources(base: string): Source[] {
  const pr = openPrDescription();
  const commits = commitMessages(base);
  return [
    ...(pr ? [{ id: 'pr' as const, label: 'Open PR description', text: pr }] : []),
    ...(commits ? [{ id: 'commits' as const, label: `Commit messages since ${base}`, text: commits }] : []),
  ];
}

const ASKED_SOURCES: readonly Source[] = [
  { id: 'type', label: 'Type it now (end with a line holding only ".")' },
  { id: 'editor', label: 'Open $EDITOR' },
  { id: 'skip', label: 'Skip: no intent' },
];

async function typed(ask: (question: string) => Promise<string>): Promise<string> {
  const lines: string[] = [];
  for (let line = await ask(''); line !== '.'; line = await ask('')) lines.push(line);
  return lines.join('\n');
}

function edited(file: string): string {
  writeFileSync(file, '## \n\nIntended behaviour:\n- \n');
  spawnSync(process.env.EDITOR || 'vi', [file], { stdio: 'inherit' });
  return readFileSync(file, 'utf8');
}

async function chooseIntent(sources: Source[], file: string): Promise<string> {
  const options = [...sources, ...ASKED_SOURCES];
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('No intent for this branch yet. Where should it come from?');
    options.forEach((option, i) => console.log(`  ${i + 1}) ${option.label}`));
    const picked = options[Number(await prompt.question('> ')) - 1];
    if (!picked) die(SCRIPT, 'no such option', 'usage');
    const answers: Record<SourceId, () => Promise<string>> = {
      pr: async () => picked.text ?? '',
      commits: async () => picked.text ?? '',
      type: () => typed((question) => prompt.question(question)),
      editor: async () => edited(file),
      skip: async () => '',
    };
    return await answers[picked.id]();
  } finally {
    prompt.close();
  }
}

async function intent(out: string, base: string): Promise<void> {
  const file = join(out, PR_BODY);
  mkdirSync(out, { recursive: true });
  if (!existsSync(file)) {
    const sources = foundSources(base);
    const text = process.stdin.isTTY ? await chooseIntent(sources, file) : (sources[0]?.text ?? '');
    writeFileSync(file, text.trim() ? `${text.trim()}\n` : '');
    console.log(`trial: intent saved to ${file}`);
  }
  const firstLine = readFileSync(file, 'utf8').split('\n').find((line) => line.trim());
  console.log(firstLine ? `trial: intent (first line): ${firstLine}` : `${NO_INTENT_WARNING}\nDelete ${file} to be asked again.`);
}

// Removes run output from one folder, keeping the person's input.
function cleanFolder(folder: string): void {
  for (const name of readdirSync(folder)) if (!KEPT.has(name)) rmSync(join(folder, name), { recursive: true, force: true });
  console.log(`trial: cleaned ${folder}, kept ${PR_BODY}`);
}

async function clean(out?: string): Promise<void> {
  if (out) return existsSync(out) ? cleanFolder(out) : console.log(`trial: nothing to clean in ${out}`);
  const current = branchFolder();
  if (existsSync(current)) return cleanFolder(current);
  const folders = existsSync(ROOT) ? readdirSync(ROOT).filter((name) => statSync(join(ROOT, name)).isDirectory()) : [];
  if (!folders.length) return console.log(`trial: nothing to clean in ${ROOT}`);
  console.log(`trial: no output for this branch (${current}). Existing folders:`);
  folders.forEach((name, i) => console.log(`  ${i + 1}) ${name}`));
  if (!process.stdin.isTTY) return;
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question('Clean which one? (number, Enter for none) > ');
  prompt.close();
  if (!answer.trim()) return console.log('trial: nothing cleaned');
  const picked = folders[Number(answer) - 1];
  if (!picked) die(SCRIPT, 'no such folder', 'usage');
  cleanFolder(join(ROOT, picked));
}

// Every mismatch between a run and the expected outcome; none means the demo passed.
function mismatches(expected: Expected, author?: AuthorOutput, reviewer?: ReviewerOutput, checked?: Checked): string[] {
  const verdicts = new Map((author?.units ?? []).map((unit) => [unitKey(unit), unit.verdict]));
  const decisions = new Map((reviewer?.defects ?? []).map((defect) => [unitKey(defect), defect.decision]));
  const found = (finding: ExpectedFinding) =>
    (reviewer?.findings ?? []).some((actual) => actual.test === finding.test && actual.severity === finding.severity && actual.reason === finding.reason);
  const dropped = [...(checked?.dropFiles ?? [])].sort();
  const expectedDrops = expected.dropFiles && [...expected.dropFiles].sort();
  return [
    ...(checked?.ok ? [] : [`agent output check: ${checked ? checked.errors.join('; ') : 'checked.json missing'}`]),
    ...(checked?.checkRejected ?? []).map(({ unit, errors }) => `${unit}: check-rejected: ${errors.join('; ')}`),
    ...(checked?.missingDefectTests ?? []).map((key) => `${key}: the Defect test is in no file of the patch (the Author removed it)`),
    ...(expected.units ?? [])
      .filter((unit) => verdicts.get(unitKey(unit)) !== unit.verdict)
      .map((unit) => `${unitKey(unit)}: Verdict ${verdicts.get(unitKey(unit)) ?? 'missing'}, expected ${unit.verdict}`),
    ...(expected.defects ?? [])
      .filter((defect) => decisions.get(unitKey(defect)) !== defect.decision)
      .map((defect) => `${unitKey(defect)}: Reviewer ${decisions.get(unitKey(defect)) ?? 'no decision'}, expected ${defect.decision}`),
    ...(expected.findings ?? [])
      .filter((finding) => !found(finding))
      .map((finding) => `${finding.test}: no ${finding.severity} ${finding.reason} Finding`),
    ...(expectedDrops && expectedDrops.join() !== dropped.join()
      ? [`dropped files: ${dropped.join(', ') || 'none'}, expected ${expectedDrops.join(', ') || 'none'}`]
      : []),
  ];
}

async function check(out: string, expectedFile: string): Promise<void> {
  const found = mismatches(
    readJson<Expected>(expectedFile),
    readJsonIfExists<AuthorOutput>(join(out, 'author.json')),
    readJsonIfExists<ReviewerOutput>(join(out, 'reviewer.json')),
    readJsonIfExists<Checked>(join(out, 'checked.json')),
  );
  if (found.length) die(SCRIPT, `demo FAIL\n${found.map((line) => `  - ${line}`).join('\n')}`);
  console.log('trial: demo PASS');
}

// ---- Backfill decisions: gaps the owner decided in an earlier Backfill (docs/backfill-decisions.json) ----

// A gap is decided when fresh records cover all its uncovered lines; a record is fresh while the file is the one
// the owner decided on. An open gap carries notes on the records that cover it only in part, or covered an older file.
type GapState = 'decided' | 'open';
type Gap = UnitRef & { uncovered: string };
type Match = { state: GapState; records: DecidedGap[]; notes: string[] };
type Matcher = (gap: Gap) => Match;
type Decided = { gap: Gap; records: DecidedGap[] };
type DecisionInput = { pkg: Pkg; pr: number; path: string; unit?: string; lines?: string; decision: GapDecision; reason: string };

const DECISIONS = 'docs/backfill-decisions.json';
// Longest line range one part of a line list may span; a longer one is a typo, not a decision.
const MAX_RANGE = 10_000;
const DECISIONS_SCHEMA = '../contracts/backfill-decisions.schema.json';
const GAP_DECISIONS: readonly GapDecision[] = ['declined', 'unreachable', 'kept-as-is'];
// A not-needed Verdict in a Backfill is the owner's decision once the PR merges.
const NOT_NEEDED_DECISIONS: Record<NotNeededReason, GapDecision> = {
  'already-covered': 'declined',
  'no-logic': 'declined',
  trivial: 'declined',
  'not-unit-testable': 'declined',
  unreachable: 'unreachable',
};

const bullets = (lines: string[]) => lines.map((line) => `  - ${line}`).join('\n');
// Gap lists and author.json may give a path from the package folder (src/x.ts); the record keeps it from the repo root.
const fromRoot = (path: string, pkg: Pkg) => (path.startsWith(`${pkg}/`) ? path : `${pkg}/${path}`);
// Agents decorate Unit names ("start (failure path)", "`createApp`"); the record keeps and compares the bare name.
const bareUnit = (unit: string) => unit.replaceAll('`', '').trim().split(/\s+/)[0];
// One Unit can hold several decisions, one per line range.
const decisionKey = (gap: { path: string; unit?: string; lines?: string }) => `${gap.path}#${gap.unit ?? ''}#${gap.lines ?? ''}`;

// The file's git blob id, as `git hash-object` prints it; undefined when the file is gone.
function blobId(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const content = readFileSync(path);
  return createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
}

function readDecisions(file: string): DecidedGap[] {
  const record = readJsonIfExists<BackfillDecisions>(file) ?? { decisions: [] };
  const errors = validate(record, readSchema(DECISIONS_SCHEMA));
  if (errors.length) die(SCRIPT, `${file} is invalid:\n${bullets(errors)}`);
  return record.decisions;
}

// Adds or replaces each entry by path and Unit, sorted, so the committed file's diff stays small.
function saveDecisions(file: string, entries: DecidedGap[]): void {
  const merged = new Map(readDecisions(file).map((gap) => [decisionKey(gap), gap]));
  for (const entry of entries) merged.set(decisionKey(entry), entry);
  const decisions = [...merged.values()].sort((a, b) => decisionKey(a).localeCompare(decisionKey(b)));
  const errors = validate({ decisions }, readSchema(DECISIONS_SCHEMA));
  if (errors.length) die(SCRIPT, `nothing recorded, an entry is invalid:\n${bullets(errors)}`);
  writeJson(file, { decisions });
}

function decidedGap(input: DecisionInput): DecidedGap {
  const path = fromRoot(input.path, input.pkg);
  const blob = blobId(path) ?? die(SCRIPT, `${path} does not exist; run from the repo root`);
  return {
    package: input.pkg,
    path,
    ...(input.unit ? { unit: bareUnit(input.unit) } : {}),
    ...(input.lines ? { lines: input.lines } : {}),
    decision: input.decision,
    reason: input.reason,
    pr: input.pr,
    blob,
  };
}

// "18, 20-22" holds 18, 20, 21 and 22. Undefined when a part is neither a line nor a range, so the gap stays open.
function lineNumbers(text: string): Set<number> | undefined {
  const lines = new Set<number>();
  for (const part of text.split(',').map((item) => item.trim())) {
    const range = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!range) return undefined;
    const [from, to] = [Number(range[1]), Number(range[2] ?? range[1])];
    if (to < from || to - from > MAX_RANGE) return undefined;
    for (let line = from; line <= to; line++) lines.add(line);
  }
  return lines;
}

// The uncovered lines no record covers. A record without lines covers the whole Unit. Undefined when unknown.
function undecidedLines(uncovered: string, records: DecidedGap[]): number[] | undefined {
  if (records.some((record) => record.lines === undefined)) return [];
  const gap = lineNumbers(uncovered);
  const decided = records.map((record) => lineNumbers(record.lines ?? ''));
  if (!gap || decided.some((lines) => !lines)) return undefined;
  return [...gap].filter((line) => !decided.some((lines) => lines?.has(line)));
}

const decidedAs = (record: DecidedGap) =>
  `${record.decision} in #${record.pr}${record.lines ? `, lines ${record.lines}` : ''}: ${record.reason}`;

function openNotes(fresh: DecidedGap[], stale: DecidedGap[], left: number[] | undefined): string[] {
  const rest = left ? `${left.length === 1 ? 'line' : 'lines'} ${left.join(', ')} ${left.length === 1 ? 'is' : 'are'} not` : 'the rest may not be';
  return [
    ...(fresh.length ? [`decided earlier only in part (${fresh.map(decidedAs).join('; ')}); ${rest}: decide again`] : []),
    ...stale.map((record) => `decided earlier (${decidedAs(record)}), but the file changed since: decide again`),
  ];
}

// A record without a Unit covers the whole file. Fresh records decide a gap; stale ones only add a note.
function matcher(records: DecidedGap[], pkg: Pkg): Matcher {
  return (gap) => {
    const path = fromRoot(gap.path, pkg);
    const blob = blobId(path);
    const mine = records.filter((entry) => entry.path === path && (entry.unit === undefined || entry.unit === bareUnit(gap.unit)));
    const fresh = mine.filter((entry) => entry.blob === blob);
    const stale = mine.filter((entry) => entry.blob !== blob);
    const left = undecidedLines(gap.uncovered, fresh);
    return fresh.length && left?.length === 0
      ? { state: 'decided', records: fresh, notes: [] }
      : { state: 'open', records: fresh, notes: openNotes(fresh, stale, left) };
  };
}

// ---- Backfill approval ----

const recommendationLines = (match: Matcher) => (item: Recommendation, i: number) => [
  `${i + 1}. \`${item.path}\` ${item.unit} — lines ${item.lines}%, branches ${item.branches}%; uncovered: ${item.uncovered}`,
  ...item.expectations.map((e) => `   - ${e.text} (${e.kind}; ${e.source})`),
  ...match(item).notes.map((note) => `   - ${note}`),
];

const unreachableLine = (match: Matcher) => (item: UnreachableGap) =>
  `- \`${item.path}\` ${item.unit} — ${item.reason} (uncovered: ${item.uncovered})${match(item).notes.map((note) => ` (${note})`).join('')}`;

const decidedLines = (decided: Decided[]) => [
  `Left out of the lists above: each file is unchanged since the decision, and the decisions cover every uncovered line. Remove an entry from \`${DECISIONS}\` to see its gap again.`,
  '',
  ...decided.map(({ gap, records }) => `- \`${gap.path}\` ${gap.unit} — ${records.map(decidedAs).join('; ')}`),
];

// Counted from the lists, so the top of gaps.md is right even when the Author's summary is not.
const countsLine = (gaps: Gaps, decided: Decided[]) =>
  `${plural(gaps.recommendations.length, 'Recommendation')}, ${gaps.unreachable.length} Unreachable, ${gaps.out_of_scope.length} out of scope, ${decided.length} decided earlier.`;

function gapsMarkdown(gaps: Gaps, match: Matcher, decided: Decided[]): string {
  return [
    '# Coverage gaps',
    '',
    `**${countsLine(gaps, decided)}**`,
    '',
    gaps.summary,
    '',
    '## Recommendations',
    ...(gaps.recommendations.length ? gaps.recommendations.flatMap(recommendationLines(match)) : ['None.']),
    '',
    '## Unreachable',
    ...(gaps.unreachable.length ? gaps.unreachable.map(unreachableLine(match)) : ['None.']),
    '',
    '## Out of scope',
    ...(gaps.out_of_scope.length ? gaps.out_of_scope.map((item) => `- \`${item.path}\` — ${item.reason}`) : ['None.']),
    '',
    '## Decided earlier',
    ...(decided.length ? decidedLines(decided) : ['None.']),
    '',
  ].join('\n');
}

// "1,3" picks by number, "all" every item, "none" no item. Anything else is a usage error.
function picked(answer: string, count: number): number[] {
  const choices: Record<string, () => number[]> = {
    all: () => Array.from({ length: count }, (_, i) => i),
    none: () => [],
  };
  const keyword = answer.trim().toLowerCase();
  if (Object.hasOwn(choices, keyword)) return choices[keyword]();
  const numbers = keyword.split(',').map((part) => Number(part.trim()));
  if (!numbers.length || numbers.some((n) => !Number.isInteger(n) || n < 1 || n > count)) {
    die(SCRIPT, `approve: "${answer}" is not 1..${count}, "all" or "none"`, 'usage');
  }
  return [...new Set(numbers)].map((n) => n - 1);
}

async function askLine(question: string): Promise<string> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await prompt.question(question);
  } finally {
    prompt.close();
  }
}

type ApproveOptions = { out: string; pkg: Pkg; decisions: string; items?: string; decline?: string; reason?: string };

// The Recommendations the owner declines, each with a reason: from --decline and --reason, or asked on a terminal.
async function declinedGaps(open: Recommendation[], chosen: number[], options: ApproveOptions): Promise<DeclinedGap[]> {
  const asking = options.decline === undefined && process.stdin.isTTY && open.length > chosen.length;
  const answer = options.decline ?? (asking ? await askLine('Decline which of the others, so later Backfills skip them? (e.g. 2,4, or Enter for none) > ') : '');
  if (!answer.trim()) return [];
  const indexes = picked(answer, open.length);
  const both = indexes.filter((i) => chosen.includes(i)).map((i) => i + 1);
  if (both.length) die(SCRIPT, `approve: ${both.join(',')} cannot be approved and declined`, 'usage');
  const declined: DeclinedGap[] = [];
  for (const i of indexes) {
    const reason = options.reason ?? (asking ? await askLine(`Why is ${i + 1} (${open[i].unit}) not worth testing? One line > `) : '');
    if (!reason.trim()) die(SCRIPT, 'approve: a declined Recommendation needs a reason (--reason)', 'usage');
    declined.push({ path: open[i].path, unit: open[i].unit, lines: open[i].uncovered, reason: reason.trim() });
  }
  return declined;
}

async function approve(options: ApproveOptions): Promise<void> {
  const { out, pkg } = options;
  const gaps = readJson<Gaps>(join(out, 'gaps.json'));
  const errors = validate(gaps, readSchema('../contracts/gaps.schema.json'));
  if (errors.length) die(SCRIPT, `gaps.json is invalid:\n${bullets(errors)}`);
  // Gaps decided earlier leave the lists before the owner sees them; a stale or partial decision only adds a note.
  const match = matcher(readDecisions(options.decisions), pkg);
  const isOpen = (gap: Gap) => match(gap).state === 'open';
  const decided: Decided[] = [...gaps.recommendations, ...gaps.unreachable].flatMap((gap) => {
    const found = match(gap);
    return found.state === 'decided' ? [{ gap, records: found.records }] : [];
  });
  const open: Gaps = { ...gaps, recommendations: gaps.recommendations.filter(isOpen), unreachable: gaps.unreachable.filter(isOpen) };
  const markdown = gapsMarkdown(open, match, decided);
  writeFileSync(join(out, 'gaps.md'), markdown);
  console.log(markdown);
  if (decided.length) console.log(`trial: ${decided.length} gaps decided earlier are left out (${DECISIONS})`);
  if (options.items === undefined && !process.stdin.isTTY) {
    return console.log(`trial: not approved yet. Pick the items with: make backfill-approve PACKAGE=${pkg} APPROVE=<1,3|all|none>`);
  }
  const count = open.recommendations.length;
  const chosen = picked(options.items ?? (await askLine('Approve which Recommendations? (e.g. 1,3,5, all, or none) > ')), count);
  const declined = await declinedGaps(open.recommendations, chosen, options);
  // Unreachable and out-of-scope items always go along: the Author records them as not-needed.
  writeJson(join(out, APPROVED), { ...open, recommendations: chosen.map((i) => open.recommendations[i]) });
  writeJson(join(out, DECLINED), declined);
  console.log(`trial: approved ${chosen.length} of ${count} Recommendations; saved to ${join(out, APPROVED)}`);
  if (declined.length) {
    console.log(`trial: declined ${declined.length}; once the PR is open, record them with: make backfill-record PACKAGE=${pkg} PR=<n>`);
  }
}

// ---- Backfill record ----

type RecordOptions = { out: string; pkg: Pkg; pr: number; decisions: string };

// The owner's decisions from one Backfill: the declined Recommendations and the Author's not-needed Units.
function record({ out, pkg, pr, decisions }: RecordOptions): void {
  const declined = readJsonIfExists<DeclinedGap[]>(join(out, DECLINED)) ?? [];
  const units = readJsonIfExists<AuthorOutput>(join(out, 'author.json'))?.units ?? [];
  const unreachable = readJsonIfExists<Gaps>(join(out, APPROVED))?.unreachable ?? [];
  const sameGap = (a: UnitRef, b: UnitRef) => fromRoot(a.path, pkg) === fromRoot(b.path, pkg) && bareUnit(a.unit) === bareUnit(b.unit);
  // The gap list says why a gap is unreachable and which lines; a Verdict only names its reason and covers the Unit.
  const unreachableGap = (unit: UnitRef, reason: NotNeededReason) =>
    reason === 'unreachable' ? unreachable.find((gap) => sameGap(gap, unit)) : undefined;
  const notNeeded = (unit: UnitRef, reason: NotNeededReason) => {
    const gap = unreachableGap(unit, reason);
    const why = gap?.reason ?? `Verdict not-needed (${reason})`;
    return decidedGap({ pkg, pr, path: unit.path, unit: unit.unit, lines: gap?.uncovered, decision: NOT_NEEDED_DECISIONS[reason], reason: why });
  };
  const entries = [
    ...declined.map((gap) => decidedGap({ pkg, pr, path: gap.path, unit: gap.unit, lines: gap.lines, decision: 'declined', reason: gap.reason })),
    ...units.flatMap(({ verdict, reason, ...unit }) => (verdict === 'not-needed' && reason ? [notNeeded(unit, reason)] : [])),
  ];
  if (!entries.length) return console.log(`trial: nothing to record in ${out}`);
  saveDecisions(decisions, entries);
  for (const entry of entries) console.log(`  - ${entry.path} ${entry.unit ?? '(whole file)'}: ${entry.decision}, ${entry.reason}`);
  console.log(`trial: recorded ${entries.length} decisions from #${pr} in ${decisions}; commit it with the Backfill PR`);
}

// ---- CLI ----

const required = (value: string | undefined, usage: string) => value?.trim() || die(SCRIPT, usage, 'usage');
const oneOf = <T extends string>(allowed: readonly T[], value: string | undefined, flag: string): T =>
  allowed.find((item) => item === value) ?? die(SCRIPT, `${flag} must be one of ${allowed.join('|')}`, 'usage');
function prNumber(value: string | undefined): number {
  const pr = Number(value);
  return Number.isInteger(pr) && pr > 0 ? pr : die(SCRIPT, '--pr must be a PR number', 'usage');
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      base: { type: 'string', default: 'main' },
      expected: { type: 'string' },
      items: { type: 'string' },
      package: { type: 'string' },
      decline: { type: 'string' },
      reason: { type: 'string' },
      pr: { type: 'string' },
      path: { type: 'string' },
      unit: { type: 'string' },
      lines: { type: 'string' },
      decision: { type: 'string' },
      decisions: { type: 'string', default: DECISIONS },
    },
  });
  const pkg = () => oneOf(PACKAGES, values.package, '--package');
  const commands: Record<Command, () => Promise<void>> = {
    dir: async () => console.log(branchFolder()),
    intent: () => intent(values.out ?? die(SCRIPT, 'intent needs --out <dir>', 'usage'), values.base),
    clean: () => clean(values.out),
    approve: () =>
      approve({
        out: required(values.out, 'approve needs --out <dir>'),
        pkg: pkg(),
        decisions: values.decisions,
        items: values.items,
        decline: values.decline,
        reason: values.reason,
      }),
    record: async () =>
      record({ out: required(values.out, 'record needs --out <dir>'), pkg: pkg(), pr: prNumber(values.pr), decisions: values.decisions }),
    decide: async () => {
      const entry = decidedGap({
        pkg: pkg(),
        pr: prNumber(values.pr),
        path: required(values.path, 'decide needs --path <file>'),
        unit: values.unit,
        lines: values.lines,
        decision: oneOf(GAP_DECISIONS, values.decision, '--decision'),
        reason: required(values.reason, 'decide needs --reason <text>').trim(),
      });
      saveDecisions(values.decisions, [entry]);
      console.log(`trial: recorded ${entry.path} ${entry.unit ?? '(whole file)'} as ${entry.decision} in ${values.decisions}`);
    },
    check: () => check(values.out ?? die(SCRIPT, 'check needs --out <dir>', 'usage'), values.expected ?? die(SCRIPT, 'check needs --expected <file>', 'usage')),
  };
  const name = positionals[0] ?? '';
  if (!Object.hasOwn(commands, name)) die(SCRIPT, 'usage: trial.ts <dir|intent|clean|check|approve|record|decide>', 'usage');
  await commands[name as Command]();
}

await main();
