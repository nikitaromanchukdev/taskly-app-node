// Flaky check for the tests the Bot commit added or changed (suites job).
//   node flaky.ts changed <head-tree> <final-tree> <package>   print those test files, relative to the package, one per line
//   node flaky.ts reruns                                        print how many shuffled reruns verify.sh makes
// verify.sh reruns them with vitest's shuffle and leaves, per package in the out dir:
//   <pkg>.rerun.files (the file list) · <pkg>.rerun.<n>.json (vitest json report of rerun n, n = 1..RERUNS)
// results.ts calls flakyFiles() to turn those into results.json. A rerun with no report counts as a failure.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { FlakyFile } from '../lib/artifacts.ts';
import { die } from '../lib/cli.ts';
import { readJsonIfExists } from '../lib/json.ts';
import { isTestPath } from '../contracts/rules.ts';
import type { Pkg } from '../contracts/rules.ts';

export const RERUNS = 3;

type VitestAssertion = { status?: string; fullName?: string };
type VitestFile = { name: string; status?: string; assertionResults?: VitestAssertion[] };
type VitestReport = { testResults?: VitestFile[] };

const SCRIPT = 'flaky';
const TEST_FILE = /\.test\.tsx?$/;
const NO_REPORT = '(no report: the rerun crashed)';
const FILE_FAILED = '(file failed to run)';

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

// Test files of the final tree that are new or differ from the head tree, relative to the package folder.
export function changedTests(headTree: string, finalTree: string, pkg: Pkg): string[] {
  const root = join(finalTree, pkg);
  if (!existsSync(root)) return [];
  return filesUnder(root)
    .map((file) => relative(root, file))
    .filter((file) => TEST_FILE.test(file) && isTestPath(`${pkg}/${file}`))
    .filter((file) => {
      const before = join(headTree, pkg, file);
      return !existsSync(before) || !readFileSync(before).equals(readFileSync(join(root, file)));
    })
    .sort();
}

// Failing test names per file (package-relative) in one vitest json report.
function failures(report: VitestReport, root: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of report.testResults ?? []) {
    const failed = (file.assertionResults ?? []).filter((test) => test.status === 'failed').map((test) => test.fullName ?? '(unnamed test)');
    const names = failed.length || file.status !== 'failed' ? failed : [FILE_FAILED];
    if (names.length) found.set(relative(root, file.name), names);
  }
  return found;
}

// The files of this package that failed in any rerun, with the failing test names and the number of failed reruns.
export function flakyFiles(dir: string, tree: string, pkg: Pkg): FlakyFile[] {
  const listFile = join(dir, `${pkg}.rerun.files`);
  if (!existsSync(listFile)) return [];
  const files = readFileSync(listFile, 'utf8').split('\n').filter(Boolean);
  const root = join(tree, pkg);
  const flaky = new Map<string, { names: Set<string>; reruns: number }>();
  const note = (file: string, names: string[]) => {
    const entry = flaky.get(file) ?? { names: new Set<string>(), reruns: 0 };
    names.forEach((name) => entry.names.add(name));
    entry.reruns += 1;
    flaky.set(file, entry);
  };
  for (let n = 1; n <= RERUNS; n++) {
    const report = readJsonIfExists<VitestReport>(join(dir, `${pkg}.rerun.${n}.json`));
    if (!report) {
      files.forEach((file) => note(file, [NO_REPORT]));
      continue;
    }
    failures(report, root).forEach((names, file) => note(file, names));
  }
  return [...flaky].map(([file, entry]) => ({ file: `${pkg}/${file}`, tests: [...entry.names], failedReruns: entry.reruns, reruns: RERUNS }));
}

function main() {
  const [command, headTree, finalTree, pkg] = process.argv.slice(2);
  switch (command) {
    case 'changed':
      if (!headTree || !finalTree || (pkg !== 'backend' && pkg !== 'frontend')) die(SCRIPT, 'usage: flaky.ts changed <head-tree> <final-tree> <backend|frontend>', 'usage');
      console.log(changedTests(headTree, finalTree, pkg).join('\n'));
      return;
    case 'reruns':
      console.log(RERUNS);
      return;
    default:
      die(SCRIPT, 'usage: flaky.ts <changed|reruns> ...', 'usage');
  }
}

if (import.meta.main) main();
