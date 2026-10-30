// changed-lines.ts mixes trusted hunks with an untrusted lcov report: it must yield only counts and line numbers.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { changedLineNumbers, coverChanged, MAX_UNCOVERED, parseLcov } from '../workflow/changed-lines.ts';

describe('changedLineNumbers', () => {
  it('lists the new-side lines of each hunk', () => {
    assert.deepEqual(changedLineNumbers([{ start: 3, count: 2 }, { start: 10, count: 1 }]), [3, 4, 10]);
  });

  it('ignores a hunk that only deleted lines (count 0)', () => {
    assert.deepEqual(changedLineNumbers([{ start: 7, count: 0 }, { start: 9, count: 1 }]), [9]);
  });

  it('merges overlapping hunks without repeats, in order', () => {
    assert.deepEqual(changedLineNumbers([{ start: 5, count: 3 }, { start: 2, count: 4 }]), [2, 3, 4, 5, 6, 7]);
  });
});

describe('parseLcov', () => {
  const lcov = ['TN:', 'SF:/repo/backend/src/a.ts', 'DA:1,3', 'DA:2,0', 'end_of_record', 'SF:src/b.ts', 'DA:4,1', 'end_of_record'].join('\n');

  it('keys files relative to the package folder and keeps line hits', () => {
    const files = parseLcov(lcov, '/repo/backend');
    assert.deepEqual([...files.keys()], ['src/a.ts', 'src/b.ts']);
    assert.deepEqual([...files.get('src/a.ts')!], [[1, 3], [2, 0]]);
  });

  it('ignores lines that are not valid SF or DA records', () => {
    const forged = ['DA:5,1', 'SF:src/c.ts', 'DA:0,1', 'DA:-3,1', 'DA:x,1', 'DA:2,y', 'DA:99999999999,1', 'DA:3.5,1', 'DA:9,99999999999999999999', '<script>', 'DA:7,2,abc', 'DA:8,1'].join('\n');
    assert.deepEqual([...parseLcov(forged, '/p').get('src/c.ts')!], [[7, 2], [8, 1]]);
  });

  it('keeps the highest hits for a repeated line', () => {
    assert.deepEqual([...parseLcov('SF:s.ts\nDA:1,0\nDA:1,4\nDA:1,2', '/p').get('s.ts')!], [[1, 4]]);
  });
});

describe('coverChanged', () => {
  const hits = new Map([[1, 1], [2, 0], [3, 5], [4, 0]]);

  it('counts only executable changed lines and names the uncovered ones', () => {
    assert.deepEqual(coverChanged([2, 3, 4, 10], hits), { covered: 1, total: 3, uncovered: [2, 4] });
  });

  it('gives 0/0 for a file lcov does not list', () => {
    assert.deepEqual(coverChanged([1, 2], undefined), { covered: 0, total: 0, uncovered: [] });
  });

  it('caps the uncovered list', () => {
    const many = Array.from({ length: MAX_UNCOVERED + 5 }, (_, i) => i + 1);
    const result = coverChanged(many, new Map(many.map((line) => [line, 0])));
    assert.equal(result.total, many.length);
    assert.equal(result.uncovered.length, MAX_UNCOVERED);
  });
});
