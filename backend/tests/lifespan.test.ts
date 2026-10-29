import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { start } from '../src/core/lifespan.ts';

// Only the failure path before listen is exercised: no port, signal handler or exit timer is created.
const mocks = vi.hoisted(() => ({
  database: { $connect: vi.fn(), $disconnect: vi.fn() },
  initialize: vi.fn(),
}));

vi.mock('../src/core/database.ts', () => ({
  createDatabase: () => mocks.database,
  initialize: mocks.initialize,
}));

let savedUrl: string | undefined;
let savedPort: string | undefined;

beforeEach(() => {
  savedUrl = process.env.DATABASE_URL;
  savedPort = process.env.API_PORT;
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  // Port 0 keeps a regressed catch path from binding port 8000.
  process.env.API_PORT = '0';
  vi.resetAllMocks();
  mocks.database.$connect.mockResolvedValue(undefined);
  mocks.database.$disconnect.mockResolvedValue(undefined);
  mocks.initialize.mockResolvedValue(undefined);
});
afterEach(() => {
  if (savedUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedUrl;
  if (savedPort === undefined) delete process.env.API_PORT;
  else process.env.API_PORT = savedPort;
});

it('characterization: rejects with the connect error and disconnects', async () => {
  const error = new Error('connect ECONNREFUSED');
  mocks.database.$connect.mockRejectedValue(error);
  await expect(start()).rejects.toBe(error);
  expect(mocks.database.$disconnect).toHaveBeenCalledOnce();
  expect(mocks.initialize).not.toHaveBeenCalled();
});
it('characterization: rejects with the initialize error and disconnects', async () => {
  const error = new Error('CREATE TABLE failed');
  mocks.initialize.mockRejectedValue(error);
  await expect(start()).rejects.toBe(error);
  expect(mocks.database.$disconnect).toHaveBeenCalledOnce();
});
