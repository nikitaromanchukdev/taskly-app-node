// publish step: how many of the lines a PR changed does the final commit's suite run?
// Inputs: the changed lines of a file from scope.json (trusted: hunks of `git diff base...head`, new-side numbers) and
// lcov line hits from the suites job (untrusted). Output: only counts and line numbers, never text from the report.
import { relative } from 'node:path';
import type { ChangedLines, Hunk } from '../lib/artifacts.ts';

// Uncovered line numbers kept per file in results.json; the Report shows fewer (see render.ts).
export const MAX_UNCOVERED = 500;
// Larger lcov line numbers are dropped as forged.
const MAX_LINE = 10_000_000;

type Hits = Map<number, number>;

// New-side line numbers of the added or modified lines. A hunk with count 0 only deleted lines and adds none.
export function changedLineNumbers(hunks: Hunk[]): number[] {
  const lines = new Set<number>();
  for (const { start, count } of hunks) {
    for (let line = start; line < start + count; line++) lines.add(line);
  }
  return [...lines].sort((a, b) => a - b);
}

const DA = /^DA:(\d+),(\d+)(?:,|$)/;
const SF = /^SF:(.+)$/;

// File -> line -> hit count. Keys are relative to the package folder, like the json-summary coverage keys.
// Anything that is not `SF:` or `DA:<line>,<hits>` with a positive line is ignored; a repeated line keeps its highest hits.
export function parseLcov(lcov: string, packageDir: string): Map<string, Hits> {
  const files = new Map<string, Hits>();
  let current: Hits | undefined;
  for (const raw of lcov.split('\n')) {
    const text = raw.trim();
    const file = SF.exec(text)?.[1];
    if (file !== undefined) {
      const key = file.startsWith('/') ? relative(packageDir, file) : file;
      current = files.get(key) ?? new Map();
      files.set(key, current);
      continue;
    }
    const hit = DA.exec(text);
    if (!hit || !current) continue;
    const line = Number(hit[1]);
    const count = Number(hit[2]);
    if (!Number.isSafeInteger(line) || line < 1 || line > MAX_LINE || !Number.isSafeInteger(count)) continue;
    current.set(line, Math.max(current.get(line) ?? 0, count));
  }
  return files;
}

// Only changed lines that lcov lists as executable count; comments, types and blank lines have no DA record.
export function coverChanged(changed: number[], hits: Hits | undefined): ChangedLines {
  const executable = changed.filter((line) => hits?.has(line));
  const uncovered = executable.filter((line) => (hits?.get(line) ?? 0) === 0);
  return { covered: executable.length - uncovered.length, total: executable.length, uncovered: uncovered.slice(0, MAX_UNCOVERED) };
}
