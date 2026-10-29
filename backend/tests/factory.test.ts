import { readFileSync } from 'node:fs';
import request from 'supertest';
import { afterEach, it, expect, vi } from 'vitest';
import { createApp } from '../src/factory.ts';
import { createDatabase } from '../src/core/database.ts';
import { record, todo } from './fixture.ts';

afterEach(() => vi.restoreAllMocks());

function setup() {
  // Construct the real Prisma client, but mock its IO: no PostgreSQL is needed.
  const database = createDatabase('postgresql://test:test@localhost:5432/test');
  return { app: createApp(database), database };
}

it('rejects a POST body that is not valid JSON with 422', async () => {
  const { app, database } = setup();
  const create = vi.spyOn(database.todo, 'create');
  const response = await request(app).post('/api/todos').set('Content-Type', 'application/json').send('{"title":');
  expect(response.status).toBe(422);
  expect(create).not.toHaveBeenCalled();
});
it('characterization: an invalid JSON body answers with detail "Invalid JSON."', async () => {
  const { app } = setup();
  const response = await request(app).post('/api/todos').set('Content-Type', 'application/json').send('{"title":');
  expect(response.body).toEqual({ detail: 'Invalid JSON.' });
});
it('returns 500 when the health query fails', async () => {
  const { app, database } = setup();
  vi.spyOn(database.todo, 'findFirst').mockRejectedValue(new Error('Database unavailable'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(500);
});
it('characterization: a failed query answers with detail "Internal Server Error", not the error message', async () => {
  const { app, database } = setup();
  vi.spyOn(database.todo, 'findFirst').mockRejectedValue(new Error('Database unavailable'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const response = await request(app).get('/api/health');
  expect(response.body).toEqual({ detail: 'Internal Server Error' });
});
it('characterization: a JSON body over the parser limit answers 413', async () => {
  const { app } = setup();
  const body = JSON.stringify({ title: 'x'.repeat(101 * 1024) });
  const response = await request(app).post('/api/todos').set('Content-Type', 'application/json').send(body);
  expect(response.status).toBe(413);
  expect(response.body).toEqual({ detail: 'Request body too large.' });
});
it('characterization: an unknown path answers 404 with detail "Not Found"', async () => {
  const { app } = setup();
  const response = await request(app).get('/api/unknown');
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Not Found' });
});
it('serves the API documentation page at /docs, following the redirect to /docs/', async () => {
  const { app } = setup();
  const response = await request(app).get('/docs').redirects(1);
  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toMatch(/text\/html/);
});
it('returns status ok from /api/health when the database answers', async () => {
  const { app, database } = setup();
  vi.spyOn(database.todo, 'findFirst').mockResolvedValue(null);
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'ok' });
});
it('returns stored rows in the task shape from GET /api/todos', async () => {
  const { app, database } = setup();
  vi.spyOn(database.todo, 'findMany').mockResolvedValue([record]);
  const response = await request(app).get('/api/todos');
  expect(response.status).toBe(200);
  expect(response.body).toEqual([todo]);
});
it('characterization: GET /openapi.json returns the contents of openapi.json', async () => {
  const { app } = setup();
  const spec = JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'));
  const response = await request(app).get('/openapi.json');
  expect(response.body).toEqual(spec);
});
