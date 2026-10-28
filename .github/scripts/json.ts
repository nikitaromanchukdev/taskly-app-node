// JSON files: reading with the path in the error, and writing in one format.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export function readJson<T = unknown>(path: string | URL): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read ${path}: ${(error as Error).message}`);
  }
}

export const readJsonIfExists = <T>(path: string): T | undefined => (existsSync(path) ? readJson<T>(path) : undefined);

export const writeJson = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
