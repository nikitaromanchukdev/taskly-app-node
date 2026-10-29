import express from 'express';
import request from 'supertest';
import { it, expect, vi } from 'vitest';
import { createTodosRouter } from '../src/features/todos/router.ts';
import { todo } from './fixture.ts';

function setup() {
  const repository = { list: vi.fn().mockResolvedValue([todo]), create: vi.fn().mockResolvedValue(todo), stats: vi.fn(), get: vi.fn(), update: vi.fn(), delete: vi.fn() };
  const app = express();
  app.use(express.json());
  app.use('/api/todos', createTodosRouter(repository));
  return { app, repository };
}
it('lists tasks from the repository', async () => {
  const { app, repository } = setup();
  const response = await request(app).get('/api/todos');
  expect(response.status).toBe(200);
  expect(response.body).toEqual([todo]);
  expect(repository.list).toHaveBeenCalledOnce();
});
it('returns task stats from the repository and not a task by ID', async () => {
  const { app, repository } = setup();
  const stats = { total: 1, open: 1, completed: 0, by_priority: { low: 0, medium: 0, high: 1 }, overdue: 0 };
  repository.stats.mockResolvedValue(stats);
  const response = await request(app).get('/api/todos/stats');
  expect(response.status).toBe(200);
  expect(response.body).toEqual(stats);
  expect(repository.stats).toHaveBeenCalledOnce();
  expect(repository.get).not.toHaveBeenCalled();
});
it('creates tasks with trimmed input and defaults', async () => {
  const { app, repository } = setup();
  const response = await request(app).post('/api/todos').send({ title: '  Plan the sprint  ', priority: 'high' });
  expect(response.status).toBe(201);
  expect(response.body).toEqual(todo);
  expect(repository.create).toHaveBeenCalledWith({ title: 'Plan the sprint', description: '', priority: 'high', due_date: null, completed: false });
});
it.each([{ title: '  ' }, { title: 'x'.repeat(121) }, { title: 'Task', priority: 'urgent' }, { title: 'Task', due_date: '2026-02-30' }])(
  'rejects invalid create input without calling the repository: %j', async (payload) => {
    const { app, repository } = setup();
    expect((await request(app).post('/api/todos').send(payload)).status).toBe(422);
    expect(repository.create).not.toHaveBeenCalled();
  },
);
it('returns 404 when GET finds no task', async () => {
  const { app, repository } = setup();
  repository.get.mockResolvedValue(null);
  const response = await request(app).get('/api/todos/1');
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Task not found.' });
});
it('returns 404 when PATCH finds no task', async () => {
  const { app, repository } = setup();
  repository.update.mockResolvedValue(null);
  const response = await request(app).patch('/api/todos/1').send({ title: 'Task' });
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Task not found.' });
});
it('returns 404 when DELETE finds no task', async () => {
  const { app, repository } = setup();
  repository.delete.mockResolvedValue(false);
  const response = await request(app).delete('/api/todos/1');
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Task not found.' });
});
it.each([
  ['get', '/api/todos/0'], ['get', '/api/todos/-1'], ['get', '/api/todos/1.5'], ['get', '/api/todos/abc'],
  ['patch', '/api/todos/0'], ['patch', '/api/todos/-1'], ['patch', '/api/todos/1.5'], ['patch', '/api/todos/abc'],
  ['delete', '/api/todos/0'], ['delete', '/api/todos/-1'], ['delete', '/api/todos/1.5'], ['delete', '/api/todos/abc'],
] as const)('rejects invalid task ids with 422 without calling the repository: %s %s', async (method, path) => {
  const { app, repository } = setup();
  const response = await request(app)[method](path);
  expect(response.status).toBe(422);
  expect(repository.get).not.toHaveBeenCalled();
  expect(repository.update).not.toHaveBeenCalled();
  expect(repository.delete).not.toHaveBeenCalled();
});
it('rejects an empty PATCH body with 422 without calling the repository', async () => {
  const { app, repository } = setup();
  const response = await request(app).patch('/api/todos/1').send({});
  expect(response.status).toBe(422);
  expect(repository.update).not.toHaveBeenCalled();
});
it('rejects a PATCH with a field outside the update schema with 422', async () => {
  const { app, repository } = setup();
  const response = await request(app).patch('/api/todos/1').send({ id: 2 });
  expect(response.status).toBe(422);
  expect(repository.update).not.toHaveBeenCalled();
});
it('updates a task from PATCH and returns the updated task', async () => {
  const { app, repository } = setup();
  const updated = { ...todo, completed: true };
  repository.update.mockResolvedValue(updated);
  const response = await request(app).patch('/api/todos/1').send({ completed: true });
  expect(response.status).toBe(200);
  expect(response.body).toEqual(updated);
  expect(repository.update).toHaveBeenCalledWith(1, { completed: true });
});
it('returns a task by ID', async () => {
  const { app, repository } = setup();
  repository.get.mockResolvedValue(todo);
  const response = await request(app).get('/api/todos/1');
  expect(response.status).toBe(200);
  expect(response.body).toEqual(todo);
  expect(repository.get).toHaveBeenCalledWith(1);
});
it('deletes a task by ID with 204 and no body', async () => {
  const { app, repository } = setup();
  repository.delete.mockResolvedValue(true);
  const response = await request(app).delete('/api/todos/1');
  expect(response.status).toBe(204);
  expect(response.text).toBe('');
  expect(repository.delete).toHaveBeenCalledWith(1);
});
