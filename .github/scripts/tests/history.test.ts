// history.ts keeps the Report comment's earlier runs in a marker that the next run reads back as untrusted text.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { entryOf, mergeHistory, MAX_SHOWN, parseHistory, renderHistory } from '../workflow/history.ts';
import type { HistoryEntry } from '../workflow/history.ts';

const REPO = 'owner/repo';
const RUN = `https://github.com/${REPO}/actions/runs/`;
const entry = (n: number, overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  sha: n.toString(16).padStart(40, 'a'),
  state: 'failure',
  text: `1 proven defect ${n}`,
  run: `${RUN}${n}`,
  at: '2026-10-30T14:05:09.000Z',
  ...overrides,
});
const bodyWith = (json: string) => `### Report\n\n<!-- pr-test-engineer:history ${json} -->`;
const parse = (list: unknown) => parseHistory(bodyWith(JSON.stringify(list)), REPO);

describe('history: render and parse', () => {
  it('reads back what it rendered', () => {
    const entries = [entry(3), entry(2), entry(1)];
    assert.deepEqual(parseHistory('### Report\n' + renderHistory(entries, REPO), REPO), entries);
  });

  it('lists the earlier runs, newest first, with commit link, status, run link and date, and not the current run', () => {
    const out = renderHistory([entry(3), entry(2, { state: 'success', text: 'all good' })], REPO);
    assert.match(out, /<details><summary>Previous runs<\/summary>/);
    assert.match(out, new RegExp(`- \\[\`aaaaaaa\`\\]\\(https://github.com/${REPO}/commit/${entry(2).sha}\\) · 🟢 success: all good · \\[run\\]\\(${RUN}2\\) · 2026-10-30 14:05 UTC`));
    assert.doesNotMatch(out.split('<!--')[0], /proven defect 3/);
  });

  it('shows no section for the first run, only the marker', () => {
    assert.equal(renderHistory([entry(1)], REPO).includes('<details>'), false);
    assert.equal(renderHistory([entry(1)], REPO).startsWith('<!-- pr-test-engineer:history'), true);
  });

  it('shows at most 10 earlier runs and keeps at most 11 in the marker', () => {
    const many = Array.from({ length: 30 }, (_, i) => entry(30 - i));
    const out = renderHistory(many, REPO);
    assert.equal(out.split('\n').filter((l) => l.startsWith('- [')).length, MAX_SHOWN);
    assert.equal(parseHistory('x\n' + out, REPO).length, MAX_SHOWN + 1);
  });

  it('cannot close the marker comment from inside the JSON', () => {
    const out = renderHistory([entry(1, { text: 'a --> <b>' })], REPO);
    assert.equal(out.split('-->').length, 2);
  });
});

describe('history: parse treats the old comment as untrusted', () => {
  it('gives nothing without a marker, for a missing body, or for broken JSON', () => {
    assert.deepEqual(parseHistory(undefined, REPO), []);
    assert.deepEqual(parseHistory('### Report', REPO), []);
    assert.deepEqual(parseHistory(bodyWith('[{"sha":'), REPO), []);
    assert.deepEqual(parseHistory(bodyWith('{"a":1}'), REPO), []);
  });

  it('ignores a marker that is not the last line', () => {
    const forged = `${bodyWith(JSON.stringify([entry(9)]))}\nmore text`;
    assert.deepEqual(parseHistory(forged, REPO), []);
  });

  it('ignores a marker larger than any run writes', () => {
    assert.deepEqual(parse([entry(1, { text: 'x'.repeat(30000) })]), []);
  });

  it('drops an entry whose sha is not hex', () => {
    assert.deepEqual(parse([entry(1, { sha: 'zzzzzzz' }), entry(2, { sha: '../../x' })]), []);
  });

  it('drops an entry with an unknown state', () => {
    assert.deepEqual(parse([entry(1, { state: 'pending' as 'success' })]), []);
  });

  it('drops an entry whose run link is not an actions run of this repo', () => {
    const bad = ['https://evil.example/owner/repo/actions/runs/1', `https://github.com/other/repo/actions/runs/1`, `${RUN}1/../../x`, `${RUN}1) [x](http://evil`, 'javascript:alert(1)'];
    assert.deepEqual(parse(bad.map((run) => entry(1, { run }))), []);
  });

  it('drops an entry with a bad date or wrong field types', () => {
    assert.deepEqual(parse([entry(1, { at: 'yesterday' }), { ...entry(2), text: 5 }, null, 'x', 7]), []);
  });

  it('keeps the good entries around a bad one', () => {
    assert.deepEqual(parse([entry(1), entry(2, { sha: 'nope' }), entry(3)]), [entry(1), entry(3)]);
  });

  it('sanitizes the text: no HTML, no outside links, one line, limited length', () => {
    const [got] = parse([entry(1, { text: '<img src=x> see https://evil.example/x\nnext ' + 'y'.repeat(500) })]);
    assert.doesNotMatch(got.text, /<|evil\.example|\n/);
    assert.ok(got.text.length <= 150 + '\n\n(truncated)'.length);
  });

  it('reads at most 11 entries', () => {
    assert.equal(parse(Array.from({ length: 50 }, (_, i) => entry(i + 1))).length, MAX_SHOWN + 1);
  });

  it('keeps a text unchanged when it is read back again', () => {
    const once = parse([entry(1, { text: 'a | b @octocat #12' })]);
    assert.deepEqual(parse(once), once);
  });
});

describe('history: merge', () => {
  it('puts this run first and keeps the earlier ones in order', () => {
    assert.deepEqual(mergeHistory([entry(2), entry(1)], entry(3)), [entry(3), entry(2), entry(1)]);
  });

  it('starts with only this run when there is no history', () => {
    assert.deepEqual(mergeHistory([], entry(1)), [entry(1)]);
  });

  it('replaces the previous line when the same commit has the same status (a re-run)', () => {
    const rerun = entry(2, { run: `${RUN}99` });
    assert.deepEqual(mergeHistory([entry(2), entry(1)], rerun), [rerun, entry(1)]);
  });

  it('keeps the previous line when the same commit has another status', () => {
    const now = entry(2, { state: 'success' });
    assert.deepEqual(mergeHistory([entry(2), entry(1)], now), [now, entry(2), entry(1)]);
  });

  it('keeps the previous line when another commit has the same status', () => {
    assert.equal(mergeHistory([entry(2)], entry(3)).length, 2);
  });

  it('keeps at most 11 entries, dropping the oldest', () => {
    const previous = Array.from({ length: 11 }, (_, i) => entry(20 - i));
    const merged = mergeHistory(previous, entry(30));
    assert.equal(merged.length, 11);
    assert.deepEqual(merged[0], entry(30));
    assert.deepEqual(merged[10], entry(11));
  });
});

describe('history: entryOf', () => {
  it('takes the analyzed commit, the status, the run link and the time', () => {
    const got = entryOf({ analyzed_sha: 'abcdef1', run_url: `${RUN}5` }, { state: 'failure', description: '1 proven defect' }, new Date('2026-10-30T14:05:09Z'), REPO);
    assert.deepEqual(got, { sha: 'abcdef1', state: 'failure', text: '1 proven defect', run: `${RUN}5`, at: '2026-10-30T14:05:09.000Z' });
  });
});
