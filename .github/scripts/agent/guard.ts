// Write guard: the agent may only touch test paths and run the shell commands listed in rules.ts.
//   guard.ts hook          PreToolUse hook for the write tools and Bash; reads the tool call as JSON on stdin.
//                          Exit 2 + reason on stderr blocks the call.
//   guard.ts patch <file>  Exit 1 if a git patch touches a non-test path or adds a symlink.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { die } from '../lib/cli.ts';
import { AGENT_COMMANDS, isTestPath } from '../contracts/rules.ts';
import { scanLines } from '../lib/scan.ts';
import type { LineRule } from '../lib/scan.ts';

type HookInput = {
  tool_name?: string;
  tool_input?: { file_path?: string; notebook_path?: string; command?: string };
  cwd?: string;
};
type HookHandler = (call: HookInput, projectDir: string | undefined) => void;
type ShellForm = { pattern: RegExp; reason: string };
type ShellHint = { words: readonly string[]; hint: string };
type PatchScan = { paths: Set<string>; symlinks: string[]; current: string };

const SCRIPT = 'guard';

function block(reason: string): never {
  return die(SCRIPT, reason, 'blocked');
}

// Resolve symlinks of the nearest existing ancestor, so a link cannot smuggle a write out of a test path.
function realTarget(absolute: string): string {
  const missing: string[] = [];
  let current = absolute;
  while (!existsSync(current) && dirname(current) !== current) {
    missing.unshift(basename(current));
    current = dirname(current);
  }
  return resolve(realpathSync(current), ...missing);
}

function readHookInput(): HookInput {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    block('hook input is not valid JSON');
  }
}

function guardWrite(call: HookInput, projectDir: string | undefined) {
  const target = call.tool_input?.file_path ?? call.tool_input?.notebook_path;
  if (!target) block(`${call.tool_name} call has no file path`);

  const root = realpathSync(projectDir ?? call.cwd ?? process.cwd());
  const path = relative(root, realTarget(resolve(call.cwd ?? root, target)));
  if (path.startsWith('..') || !isTestPath(path)) {
    block(`${call.tool_name} to ${target} refused: only test files may be written (rules.ts)`);
  }
}

// Shell forms refused anywhere in a command, also after an allowed prefix.
const SHELL_FORMS: readonly ShellForm[] = [
  { pattern: /[<>]/, reason: 'redirects read or write files: use Read, Write or Edit' },
  { pattern: /[;&|\n\r]/, reason: 'chains, pipes and background jobs are refused: run one command per call' },
  { pattern: /[$`]/, reason: 'variables and command substitution are refused: write the value out' },
  { pattern: /[()\\]/, reason: 'subshells and escapes are refused: run one plain command' },
  { pattern: /(?:^|\s)--(?:output|no-index)(?:[=\s]|$)/, reason: 'git --output writes and --no-index reads files: use Write or Read' },
];

// The tool to use instead of a refused command, by its first word without the folder.
const SHELL_HINTS: readonly ShellHint[] = [
  { words: ['cat', 'head', 'tail', 'less', 'more', 'wc', 'nl', 'awk'], hint: 'use Read to read a file' },
  { words: ['sed'], hint: 'use Read to read a file and Edit to change it' },
  { words: ['grep', 'egrep', 'rg', 'find', 'ls', 'tree'], hint: 'use Grep to search file contents and Glob to find files' },
  { words: ['echo', 'printf', 'tee', 'touch', 'cp', 'mv', 'rm', 'mkdir'], hint: 'use Write or Edit to change a file' },
  { words: ['cd'], hint: 'do not cd: every command runs from the repo root' },
  {
    words: ['npm', 'npx', 'node', 'tsc', 'vitest', 'bash', 'sh', 'sandbox.sh'],
    hint: 'run tests only as .github/scripts/agent/sandbox.sh test|typecheck <backend|frontend>, directly from the repo root',
  },
  { words: ['git'], hint: 'of git, only diff, log, show and status are allowed' },
];

const startsWithCommand = (words: readonly string[], allowed: string) =>
  allowed.split(' ').every((word, i) => words[i] === word);

function guardShell(call: HookInput) {
  const command = call.tool_input?.command?.trim();
  if (!command) block('Bash call has no command');

  const reasons = SHELL_FORMS.filter(({ pattern }) => pattern.test(command)).map(({ reason }) => reason);
  const words = command.split(/\s+/);
  if (!AGENT_COMMANDS.some((allowed) => startsWithCommand(words, allowed))) {
    const first = basename(words[0]);
    reasons.push(SHELL_HINTS.find((rule) => rule.words.includes(first))?.hint ?? 'this command is not allowed');
  }
  if (reasons.length) {
    block(`Bash command refused: ${reasons.join('; ')}. Allowed, one per call: ${AGENT_COMMANDS.join(', ')}`);
  }
}

// Tools without an entry pass through.
const HOOKS = new Map<string, HookHandler>([
  ['Write', guardWrite],
  ['Edit', guardWrite],
  ['MultiEdit', guardWrite],
  ['NotebookEdit', guardWrite],
  ['Bash', guardShell],
]);

function hook(projectDir: string | undefined) {
  const call = readHookInput();
  HOOKS.get(call.tool_name ?? '')?.(call, projectDir);
}

// Every header that can introduce a file.
const PATCH_LINES: readonly LineRule<PatchScan>[] = [
  {
    pattern: /^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/,
    apply: (scan, [, from, to]) => {
      scan.paths.add(from).add(to);
      scan.current = to;
    },
  },
  { pattern: /^(?:rename|copy) (?:from|to) (.+)$/, apply: (scan, [, path]) => scan.paths.add(path) },
  { pattern: /^(?:---|\+\+\+) (?:[ab]\/)?(.+)$/, apply: (scan, [, path]) => path !== '/dev/null' && scan.paths.add(path) },
  { pattern: /^(?:new file mode|new mode) 120000$/, apply: (scan) => scan.symlinks.push(scan.current) },
];

function patchPaths(patch: string): { paths: string[]; symlinks: string[] } {
  const scan = scanLines<PatchScan>(patch, PATCH_LINES, { paths: new Set(), symlinks: [], current: '' });
  return { paths: [...scan.paths], symlinks: scan.symlinks };
}

const isSafeTestPath = (path: string) =>
  !path.includes('..') && !path.startsWith('/') && !path.startsWith('"') && isTestPath(path);

function patch(file: string | undefined) {
  if (!file) die(SCRIPT, 'usage: guard.ts patch <file>', 'usage');
  const { paths, symlinks } = patchPaths(readFileSync(file, 'utf8'));
  const bad = paths.filter((path) => !isSafeTestPath(path));
  for (const path of bad) console.error(`${SCRIPT}: patch touches non-test path ${path}`);
  for (const path of symlinks) console.error(`${SCRIPT}: patch creates symlink ${path}`);
  if (bad.length || symlinks.length) die(SCRIPT, 'patch rejected');
  console.log(`${SCRIPT}: patch ok (${paths.length} paths)`);
}

if (import.meta.main) {
  const [mode, arg] = process.argv.slice(2);
  switch (mode) {
    case 'hook':
      hook(process.env.CLAUDE_PROJECT_DIR);
      break;
    case 'patch':
      patch(arg);
      break;
    default:
      die(SCRIPT, 'usage: guard.ts <hook|patch <file>>', 'usage');
  }
}
