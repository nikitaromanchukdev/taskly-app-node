import { afterEach, it, expect, vi } from 'vitest';
import { createDatabase, initialize } from '../src/core/database.ts';

afterEach(() => vi.restoreAllMocks());

function setup() {
  // Construct the real Prisma client, but mock its IO: no PostgreSQL is needed.
  const database = createDatabase('postgresql://test:test@localhost:5432/test');
  return { database, executeRaw: vi.spyOn(database, '$executeRaw') };
}

function sqlOf(call: unknown[]): string {
  return (call[0] as TemplateStringsArray).join('');
}

it('characterization: rejects with the same error when the table statement fails', async () => {
  const { database, executeRaw } = setup();
  const error = new Error('connection refused');
  executeRaw.mockRejectedValue(error);
  await expect(initialize(database)).rejects.toBe(error);
});
it('creates the todos table with the title, description and priority limits of the API contract', async () => {
  const { database, executeRaw } = setup();
  executeRaw.mockResolvedValue(0);
  await initialize(database);
  const sql = sqlOf(executeRaw.mock.calls[0]);
  expect(sql).toContain('VARCHAR(120)');
  expect(sql).toContain('VARCHAR(2000)');
  expect(sql).toContain("priority IN ('low', 'medium', 'high')");
  expect(sql).toContain("DEFAULT 'medium'");
});
it('characterization: creates the todos table only if it does not exist', async () => {
  const { database, executeRaw } = setup();
  executeRaw.mockResolvedValue(0);
  await initialize(database);
  expect(executeRaw).toHaveBeenCalledOnce();
  expect(sqlOf(executeRaw.mock.calls[0])).toContain('CREATE TABLE IF NOT EXISTS todos');
});
