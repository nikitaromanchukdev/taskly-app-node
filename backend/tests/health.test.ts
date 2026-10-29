import express from 'express';
import request from 'supertest';
import { afterEach, it, expect, vi } from 'vitest';
import { createHealthRouter } from '../src/api/health.ts';
import { createDatabase } from '../src/core/database.ts';

afterEach(() => vi.restoreAllMocks());

function setup() {
  // Construct the real Prisma client, but mock its IO: no PostgreSQL is needed.
  const database = createDatabase('postgresql://test:test@localhost:5432/test');
  const app = express();
  app.use('/api', createHealthRouter(database));
  return { app, database };
}

it('returns 500 when the health query fails', async () => {
  const { app, database } = setup();
  vi.spyOn(database.todo, 'findFirst').mockRejectedValue(new Error('Database unavailable'));
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(500);
});
it('returns status ok when the health query succeeds', async () => {
  const { app, database } = setup();
  vi.spyOn(database.todo, 'findFirst').mockResolvedValue(null);
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'ok' });
});
