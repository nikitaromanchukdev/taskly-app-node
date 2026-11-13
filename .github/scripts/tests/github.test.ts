// github.ts retries a 5xx or a network error with a short backoff, and never a 4xx.
import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { github } from '../workflow/github.ts';

type Reply = { status: number; body?: string } | Error;

// Replaces global fetch with one that answers from the list, one reply per call.
function stubFetch(replies: Reply[]) {
  const stub = mock.method(globalThis, 'fetch', async () => {
    const reply = replies.shift() ?? assert.fail('more calls than replies');
    if (reply instanceof Error) throw reply;
    return new Response(reply.body ?? '{}', { status: reply.status });
  });
  return stub;
}

const pauses: number[] = [];
const client = () => github({ token: 'secret-token', sleep: async (ms) => void pauses.push(ms) });

afterEach(() => {
  mock.restoreAll();
  pauses.length = 0;
});

describe('github.ts request retries', () => {
  it('succeeds after one retry when a 500 is followed by a 200', async () => {
    const fetchStub = stubFetch([{ status: 500, body: 'boom' }, { status: 200, body: '{"ok":true}' }]);
    mock.method(console, 'error', () => {});
    assert.deepEqual(await client().request('/x', { method: 'POST', body: {} }), { ok: true });
    assert.equal(fetchStub.mock.callCount(), 2);
    assert.deepEqual(pauses, [1000]);
  });

  it('fails with the last error after three 5xx answers, pausing 1s then 3s', async () => {
    const fetchStub = stubFetch([{ status: 500, body: 'a' }, { status: 502, body: 'b' }, { status: 503, body: 'last' }]);
    mock.method(console, 'error', () => {});
    await assert.rejects(client().request('/x', { method: 'POST', body: {} }), /POST \/x -> 503: last/);
    assert.equal(fetchStub.mock.callCount(), 3);
    assert.deepEqual(pauses, [1000, 3000]);
  });

  it('does not retry a 404', async () => {
    const fetchStub = stubFetch([{ status: 404, body: 'nope' }]);
    await assert.rejects(client().request('/x'), /GET \/x -> 404: nope/);
    assert.equal(fetchStub.mock.callCount(), 1);
    assert.deepEqual(pauses, []);
  });

  it('retries a network error', async () => {
    const fetchStub = stubFetch([new TypeError('fetch failed'), { status: 200, body: '[]' }]);
    mock.method(console, 'error', () => {});
    assert.deepEqual(await client().request('/x'), []);
    assert.equal(fetchStub.mock.callCount(), 2);
  });

  it('logs each retry with method, path and status, and never the token', async () => {
    stubFetch([{ status: 500 }, { status: 200 }]);
    const logged = mock.method(console, 'error', () => {});
    await client().request('/repos/o/r/statuses/abc', { method: 'POST', body: {} });
    const lines = logged.mock.calls.map((call) => String(call.arguments[0]));
    assert.equal(lines.length, 1);
    assert.match(lines[0], /POST \/repos\/o\/r\/statuses\/abc -> 500/);
    assert.ok(!lines[0].includes('secret-token'));
  });
});
