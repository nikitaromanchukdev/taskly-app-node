// Test helpers: run a CLI script the way the workflow does, as its own process, and make throwaway folders.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type Exit = { code: number | null; stdout: string; stderr: string };
export type RunOptions = { input?: string; env?: Record<string, string>; cwd?: string };

const SCRIPTS = new URL('..', import.meta.url).pathname;

export function runScript(script: string, args: readonly string[], options: RunOptions = {}): Exit {
  const result = spawnSync(process.execPath, [join(SCRIPTS, script), ...args], {
    input: options.input ?? '',
    cwd: options.cwd,
    env: { PATH: process.env.PATH ?? '', ...options.env },
    encoding: 'utf8',
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

export const tempDir = () => realpathSync(mkdtempSync(join(tmpdir(), 'script-test-')));
