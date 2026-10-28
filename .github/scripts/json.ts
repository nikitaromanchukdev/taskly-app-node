// JSON files: reading with the path in the error, and writing in one format.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function readJson<T = unknown>(path: string | URL): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read ${path}: ${(error as Error).message}`);
  }
}

export const readJsonIfExists = <T>(path: string): T | undefined => (existsSync(path) ? readJson<T>(path) : undefined);

// Creates the folder first: a job whose upstream died before uploading anything has no artifact folder yet.
export function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}
