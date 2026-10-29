// Local trial helpers for the Makefile: the per-branch output folder, the intended behaviour, and cleanup.
// Usage: node trial.ts dir                         print the output folder of the current branch
//        node trial.ts intent --out <dir> --base <branch>
//                                                   make sure <dir>/pr-body.md exists; ask where it comes from
//        node trial.ts clean [--out <dir>]          clean <dir>, else the current branch's folder, or pick one
//        node trial.ts check --out <dir> --expected <file>
//                                                   compare a run with the outcome the demo expects
//        node trial.ts approve --out <dir> [--items <1,3|all|none>]
//                                                   Backfill: render <dir>/gaps.json as gaps.md, then write the
//                                                   Recommendations the owner approves to <dir>/approved.json
// Questions are asked only on a terminal. Without one, intent takes the first source found, clean lists folders,
// and approve without --items only renders gaps.md.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import type { AuthorOutput, Checked, DefectDecision, Gaps, Recommendation, ReviewerOutput, Verdict } from './artifacts.ts';
import { unitKey } from './artifacts.ts';
import { die } from './cli.ts';
import { readJson, readJsonIfExists, writeJson } from './json.ts';
import { readSchema, validate } from './schema.ts';

type Command = 'dir' | 'intent' | 'clean' | 'check' | 'approve';
type SourceId = 'pr' | 'commits' | 'type' | 'editor' | 'skip';
type Source = { id: SourceId; label: string; text?: string };
type UnitRef = { path: string; unit: string };
// What a demo run must produce: each Unit's Verdict and each Defect's Reviewer decision.
type Expected = { units: (UnitRef & { verdict: Verdict })[]; defects: (UnitRef & { decision: DefectDecision })[] };

const SCRIPT = 'trial.ts';
const ROOT = '.test-agent';
const PR_BODY = 'pr-body.md';
const APPROVED = 'approved.json';
// Kept by clean: the person's input, not run output.
const KEPT = new Set([PR_BODY, APPROVED]);
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
  return [
    ...(checked?.ok ? [] : [`agent output check: ${checked ? checked.errors.join('; ') : 'checked.json missing'}`]),
    ...expected.units
      .filter((unit) => verdicts.get(unitKey(unit)) !== unit.verdict)
      .map((unit) => `${unitKey(unit)}: Verdict ${verdicts.get(unitKey(unit)) ?? 'missing'}, expected ${unit.verdict}`),
    ...expected.defects
      .filter((defect) => decisions.get(unitKey(defect)) !== defect.decision)
      .map((defect) => `${unitKey(defect)}: Reviewer ${decisions.get(unitKey(defect)) ?? 'no decision'}, expected ${defect.decision}`),
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

// ---- Backfill approval ----

const recommendationLines = (item: Recommendation, i: number) => [
  `${i + 1}. \`${item.path}\` ${item.unit} — lines ${item.lines}%, branches ${item.branches}%`,
  ...item.expectations.map((e) => `   - ${e.text} (${e.kind}; ${e.source})`),
];

function gapsMarkdown(gaps: Gaps): string {
  return [
    '# Coverage gaps',
    '',
    gaps.summary,
    '',
    '## Recommendations',
    ...(gaps.recommendations.length ? gaps.recommendations.flatMap(recommendationLines) : ['None.']),
    '',
    '## Unreachable',
    ...(gaps.unreachable.length ? gaps.unreachable.map((item) => `- \`${item.path}\` ${item.unit} — ${item.reason}`) : ['None.']),
    '',
    '## Out of scope',
    ...(gaps.out_of_scope.length ? gaps.out_of_scope.map((item) => `- \`${item.path}\` — ${item.reason}`) : ['None.']),
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

async function askItems(): Promise<string> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await prompt.question('Approve which Recommendations? (e.g. 1,3,5, all, or none) > ');
  } finally {
    prompt.close();
  }
}

async function approve(out: string, items?: string): Promise<void> {
  const gaps = readJson<Gaps>(join(out, 'gaps.json'));
  const errors = validate(gaps, readSchema('./gaps.schema.json'));
  if (errors.length) die(SCRIPT, `gaps.json is invalid:\n${errors.map((error) => `  - ${error}`).join('\n')}`);
  const markdown = gapsMarkdown(gaps);
  writeFileSync(join(out, 'gaps.md'), markdown);
  console.log(markdown);
  if (items === undefined && !process.stdin.isTTY) {
    return console.log(`trial: not approved yet. Pick the items with: make backfill-approve PACKAGE=<package> APPROVE=<1,3|all|none>`);
  }
  const chosen = picked(items ?? (await askItems()), gaps.recommendations.length);
  // Unreachable and out-of-scope items always go along: the Author records them as not-needed.
  writeJson(join(out, APPROVED), { ...gaps, recommendations: chosen.map((i) => gaps.recommendations[i]) });
  console.log(`trial: approved ${chosen.length} of ${gaps.recommendations.length} Recommendations; saved to ${join(out, APPROVED)}`);
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { out: { type: 'string' }, base: { type: 'string', default: 'main' }, expected: { type: 'string' }, items: { type: 'string' } },
  });
  const commands: Record<Command, () => Promise<void>> = {
    dir: async () => console.log(branchFolder()),
    intent: () => intent(values.out ?? die(SCRIPT, 'intent needs --out <dir>', 'usage'), values.base),
    clean: () => clean(values.out),
    approve: () => approve(values.out ?? die(SCRIPT, 'approve needs --out <dir>', 'usage'), values.items),
    check: () => check(values.out ?? die(SCRIPT, 'check needs --out <dir>', 'usage'), values.expected ?? die(SCRIPT, 'check needs --expected <file>', 'usage')),
  };
  const name = positionals[0] ?? '';
  if (!Object.hasOwn(commands, name)) die(SCRIPT, 'usage: trial.ts <dir|intent|clean|check|approve>', 'usage');
  await commands[name as Command]();
}

await main();
