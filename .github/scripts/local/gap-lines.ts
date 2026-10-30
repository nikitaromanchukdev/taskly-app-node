// Backfill: check and fix each gap's `uncovered` lines in gaps.json against the package's lcov.info.
// Usage: node gap-lines.ts --out <dir> --package <backend|frontend> [--lcov <file>]
// The Author names the gaps; this script owns their line numbers, so the matching against
// docs/backfill-decisions.json (trial.ts approve) never depends on a number the model got wrong.
// For each Recommendation and Unreachable item:
//   - a listed line is uncovered in lcov.info when it has `DA:<line>,0`, a branch with `BRDA:<line>,...,0` or
//     `-`, or a function with `FNDA:0` at the line of its `FN`. Listed lines that are not uncovered are dropped,
//     with a warning on stderr: a gaps run is too costly to repeat for one wrong number.
//   - the list is then rewritten as all uncovered lines of the file from its first to its last kept line,
//     so a line the Author left out inside that span is added.
//   - it fails, with gaps.json untouched, when a gap keeps no line, its file has no record in lcov.info,
//     or its list cannot be read.
// lcov.info is read from <package>/coverage/report/ (the sandbox's output folder), else <package>/coverage/.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { Gaps } from '../lib/artifacts.ts';
import { die } from '../lib/cli.ts';
import { readJson, writeJson } from '../lib/json.ts';
import { PACKAGES } from '../contracts/rules.ts';
import type { Pkg } from '../contracts/rules.ts';

const SCRIPT = 'gap-lines.ts';
// Longest line range one part of a line list may span; a longer one is a typo.
const MAX_RANGE = 10_000;

type Item = { path: string; unit: string; uncovered: string };
type Fixed = { uncovered: string; dropped: number[] } | { problem: string };
// The uncovered lines of one source file: a line, a branch or a function that no test reaches.
type FileGaps = Set<number>;

// lcov.info by source file path as written after `SF:`. Records end at `end_of_record`.
function parseLcov(text: string): Map<string, FileGaps> {
  const files = new Map<string, FileGaps>();
  let current: FileGaps = new Set();
  // FN and FNDA rows of one record meet by function name.
  let functionLines = new Map<string, number>();
  for (const raw of text.split('\n')) {
    const row = raw.trim();
    const colon = row.indexOf(':');
    const tag = colon < 0 ? row : row.slice(0, colon);
    const fields = row.slice(colon + 1).split(',');
    switch (tag) {
      case 'SF':
        current = new Set();
        functionLines = new Map();
        files.set(row.slice(colon + 1), current);
        break;
      case 'DA':
        if (fields[1] === '0') current.add(Number(fields[0]));
        break;
      case 'BRDA':
        if (fields[3] === '0' || fields[3] === '-') current.add(Number(fields[0]));
        break;
      case 'FN':
        functionLines.set(fields.slice(1).join(','), Number(fields[0]));
        break;
      case 'FNDA': {
        const line = functionLines.get(fields.slice(1).join(','));
        if (fields[0] === '0' && line !== undefined) current.add(line);
        break;
      }
    }
  }
  return files;
}

// The lcov record of a repo-root path like frontend/src/a.ts. lcov paths are relative to the package or absolute.
function gapsOf(files: Map<string, FileGaps>, path: string, pkg: Pkg): FileGaps | undefined {
  const inPackage = path.startsWith(`${pkg}/`) ? path.slice(pkg.length + 1) : path;
  for (const [name, gaps] of files) {
    if (name === inPackage || name === path || name.endsWith(`/${path}`) || name.endsWith(`/${inPackage}`)) return gaps;
  }
  return undefined;
}

// "18, 20-22" holds 18, 20, 21 and 22. Undefined when a part is neither a line nor a range.
function lineNumbers(text: string): number[] | undefined {
  const lines: number[] = [];
  for (const part of text.split(',').map((item) => item.trim())) {
    const range = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!range) return undefined;
    const [from, to] = [Number(range[1]), Number(range[2] ?? range[1])];
    if (to < from || to - from > MAX_RANGE) return undefined;
    for (let line = from; line <= to; line++) lines.push(line);
  }
  return lines;
}

// [18, 20, 21, 22] as "18, 20-22".
function lineList(lines: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let end = i;
    while (lines[end + 1] === lines[end] + 1) end++;
    parts.push(end === i ? `${lines[i]}` : `${lines[i]}-${lines[end]}`);
    i = end;
  }
  return parts.join(', ');
}

// The new `uncovered` text of one item, or the reason it cannot be trusted.
function fixed(item: Item, file: FileGaps | undefined): Fixed {
  const label = `${item.path} ${item.unit}`;
  if (!file) return { problem: `${label}: no record in lcov.info for ${item.path}` };
  const claimed = lineNumbers(item.uncovered);
  if (!claimed?.length) return { problem: `${label}: cannot read the line list "${item.uncovered}"` };
  const kept = claimed.filter((line) => file.has(line));
  if (!kept.length) return { problem: `${label}: none of the listed lines "${item.uncovered}" is uncovered in lcov.info` };
  const [first, last] = [Math.min(...kept), Math.max(...kept)];
  return { uncovered: lineList([...file].filter((line) => line >= first && line <= last).sort((a, b) => a - b)), dropped: claimed.filter((line) => !file.has(line)) };
}

function main(): void {
  const { values } = parseArgs({ options: { out: { type: 'string' }, package: { type: 'string' }, lcov: { type: 'string' } } });
  const out = values.out ?? die(SCRIPT, 'needs --out <dir>', 'usage');
  const pkg = PACKAGES.find((name) => name === values.package) ?? die(SCRIPT, `--package must be one of ${PACKAGES.join(', ')}`, 'usage');
  const candidates = values.lcov ? [values.lcov] : [join(pkg, 'coverage', 'report', 'lcov.info'), join(pkg, 'coverage', 'lcov.info')];
  const lcovFile = candidates.find((file) => existsSync(file));
  if (!lcovFile) die(SCRIPT, `no lcov.info (looked in ${candidates.join(', ')}); the gaps run measures coverage first`);
  console.log(`${SCRIPT}: reading ${lcovFile}`);
  const files = parseLcov(readFileSync(lcovFile, 'utf8'));
  const gapsFile = join(out, 'gaps.json');
  const gaps = readJson<Gaps>(gapsFile);

  const problems: string[] = [];
  let changed = 0;
  const fix = <T extends Item>(items: T[]): T[] =>
    items.map((item) => {
      const result = fixed(item, gapsOf(files, item.path, pkg));
      if ('problem' in result) {
        problems.push(result.problem);
        return item;
      }
      if (result.dropped.length) {
        console.error(`${SCRIPT}: warning: ${item.path} ${item.unit}: dropped lines ${lineList(result.dropped)}, covered in lcov.info`);
      }
      if (result.uncovered !== item.uncovered) {
        changed++;
        console.log(`${SCRIPT}: ${item.path} ${item.unit}: uncovered "${item.uncovered}" -> "${result.uncovered}"`);
      }
      return { ...item, uncovered: result.uncovered };
    });
  const next = { ...gaps, recommendations: fix(gaps.recommendations), unreachable: fix(gaps.unreachable) };
  if (problems.length) {
    die(SCRIPT, `gaps.json cannot be matched to ${lcovFile}; nothing changed:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
  writeJson(gapsFile, next);
  console.log(`${SCRIPT}: checked ${next.recommendations.length + next.unreachable.length} gaps against ${lcovFile}; ${changed} completed`);
}

main();
