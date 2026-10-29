import { afterEach, beforeEach, it, expect } from 'vitest';
import { resolveDatabaseUrl } from '../src/core/config.ts';

// config.ts loads the root .env at import time. Clear these names before each test and restore them after.
const names = ['DATABASE_URL', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_HOST', 'DB_PORT', 'POSTGRES_DB'];
const postgresVars = { POSTGRES_USER: 'taskly', POSTGRES_PASSWORD: 's3cret', POSTGRES_HOST: 'localhost', DB_PORT: '5432', POSTGRES_DB: 'taskly' };
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
});
afterEach(() => {
  for (const name of names) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

it.each(Object.keys(postgresVars))('throws naming the missing variable %s when no URL is set', (missing) => {
  for (const [name, value] of Object.entries(postgresVars)) {
    if (name !== missing) process.env[name] = value;
  }
  expect(() => resolveDatabaseUrl()).toThrow(`Missing environment variable: ${missing}`);
});
it('characterization: an explicit override wins over DATABASE_URL', () => {
  process.env.DATABASE_URL = 'postgresql://env@localhost/env';
  expect(resolveDatabaseUrl('postgresql://override@localhost/override')).toBe('postgresql://override@localhost/override');
});
it('characterization: DATABASE_URL is returned unchanged when no override is given', () => {
  process.env.DATABASE_URL = 'postgresql://app:pw@db.internal:6543/app';
  expect(resolveDatabaseUrl()).toBe('postgresql://app:pw@db.internal:6543/app');
});
it('characterization: a postgresql+psycopg scheme is rewritten to postgresql', () => {
  expect(resolveDatabaseUrl('postgresql+psycopg://app:pw@localhost:5432/app')).toBe('postgresql://app:pw@localhost:5432/app');
});
it('builds a postgresql URL from the POSTGRES_* variables and DB_PORT', () => {
  Object.assign(process.env, postgresVars);
  expect(resolveDatabaseUrl()).toBe('postgresql://taskly:s3cret@localhost:5432/taskly');
});
