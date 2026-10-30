// gap-lines.ts checks the Author's `uncovered` lines against lcov.info and completes them.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runScript, tempDir } from './run.ts';

// a.ts: lines 3 and 7 never run, line 5 has an untaken branch, functions `skip` (line 10) and `late` (line 13, no DA row) are never called.
// b.ts: line 2 never runs.
const LCOV = `TN:
SF:src/a.ts
FN:1,run
FN:10,skip
FN:13,late
FNDA:4,run
FNDA:0,skip
FNDA:0,late
DA:1,4
DA:3,0
DA:5,4
DA:7,0
DA:10,0
DA:11,0
BRDA:5,0,0,4
BRDA:5,0,1,0
BRDA:8,0,0,-
end_of_record
SF:src/b.ts
DA:1,1
DA:2,0
end_of_record
`;

const item = (path: string, unit: string, uncovered: string) => ({ path, unit, uncovered });

// Writes gaps.json and the package's lcov.info into a folder that is both the output folder and the repo root.
function run(recommendations: object[], unreachable: object[] = [], lcovPath = 'frontend/coverage/lcov.info') {
  const dir = tempDir();
  mkdirSync(join(dir, lcovPath, '..'), { recursive: true });
  writeFileSync(join(dir, lcovPath), LCOV);
  writeFileSync(join(dir, 'gaps.json'), JSON.stringify({ summary: 's', recommendations, unreachable, out_of_scope: [] }));
  const result = runScript('local/gap-lines.ts', ['--out', dir, '--package', 'frontend'], { cwd: dir });
  const gaps = JSON.parse(readFileSync(join(dir, 'gaps.json'), 'utf8'));
  return { ...result, gaps };
}

describe('gap-lines.ts', () => {
  it('keeps lines that lcov.info reports as uncovered', () => {
    const { code, gaps } = run([item('frontend/src/a.ts', 'run', '3, 5, 7')]);
    assert.equal(code, 0);
    assert.equal(gaps.recommendations[0].uncovered, '3, 5, 7');
  });

  it('adds an uncovered line the Author left out inside its span', () => {
    const { code, gaps, stdout } = run([item('frontend/src/a.ts', 'run', '3, 7')]);
    assert.equal(code, 0);
    assert.equal(gaps.recommendations[0].uncovered, '3, 5, 7');
    assert.match(stdout, /uncovered "3, 7" -> "3, 5, 7"/);
  });

  it('does not add lines outside the span the Author listed', () => {
    const { gaps } = run([item('frontend/src/a.ts', 'run', '3')]);
    assert.equal(gaps.recommendations[0].uncovered, '3');
  });

  it('counts an untaken branch, a "-" branch and an uncalled function as uncovered', () => {
    const { code, gaps } = run([item('frontend/src/a.ts', 'all', '3, 13')]);
    assert.equal(code, 0);
    assert.equal(gaps.recommendations[0].uncovered, '3, 5, 7-8, 10-11, 13');
  });

  it('checks Unreachable items the same way', () => {
    const { code, gaps } = run([], [item('frontend/src/b.ts', 'start', '2')]);
    assert.equal(code, 0);
    assert.equal(gaps.unreachable[0].uncovered, '2');
  });

  it('drops listed lines that are covered, with a warning naming them', () => {
    const { code, stderr, gaps } = run([item('frontend/src/a.ts', 'run', '3, 4, 6, 7')]);
    assert.equal(code, 0);
    assert.equal(gaps.recommendations[0].uncovered, '3, 5, 7');
    assert.match(stderr, /warning: frontend\/src\/a\.ts run: dropped lines 4, 6, covered in lcov\.info/);
  });

  it('does not warn when every listed line is uncovered', () => {
    assert.equal(run([item('frontend/src/a.ts', 'run', '3, 7')]).stderr, '');
  });

  it('fails, leaving gaps.json as it was, when no listed line is uncovered', () => {
    const before = [item('frontend/src/a.ts', 'run', '4, 6')];
    const { code, stderr, gaps } = run(before);
    assert.equal(code, 1);
    assert.match(stderr, /frontend\/src\/a\.ts run: none of the listed lines "4, 6" is uncovered/);
    assert.deepEqual(gaps.recommendations, before);
  });

  it('reads coverage/report/lcov.info and says so', () => {
    const { code, stdout } = run([item('frontend/src/a.ts', 'run', '3')], [], 'frontend/coverage/report/lcov.info');
    assert.equal(code, 0);
    assert.match(stdout, /reading frontend\/coverage\/report\/lcov\.info/);
  });

  it('reads coverage/lcov.info when there is no report folder', () => {
    assert.match(run([item('frontend/src/a.ts', 'run', '3')]).stdout, /reading frontend\/coverage\/lcov\.info/);
  });

  it('prefers coverage/report/lcov.info when both exist', () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'frontend/coverage/report'), { recursive: true });
    writeFileSync(join(dir, 'frontend/coverage/lcov.info'), 'SF:src/a.ts\nDA:3,0\nend_of_record\n');
    writeFileSync(join(dir, 'frontend/coverage/report/lcov.info'), LCOV);
    writeFileSync(join(dir, 'gaps.json'), JSON.stringify({ summary: '', recommendations: [item('frontend/src/a.ts', 'run', '3, 7')], unreachable: [], out_of_scope: [] }));
    const { stdout } = runScript('local/gap-lines.ts', ['--out', dir, '--package', 'frontend'], { cwd: dir });
    assert.match(stdout, /reading frontend\/coverage\/report\/lcov\.info/);
    assert.equal(JSON.parse(readFileSync(join(dir, 'gaps.json'), 'utf8')).recommendations[0].uncovered, '3, 5, 7');
  });

  it('fails when lcov.info has no record of the file', () => {
    const { code, stderr } = run([item('frontend/src/gone.ts', 'x', '1')]);
    assert.equal(code, 1);
    assert.match(stderr, /no record in lcov\.info for frontend\/src\/gone\.ts/);
  });

  it('fails when the line list cannot be read', () => {
    const { code, stderr } = run([item('frontend/src/a.ts', 'run', 'lines 3 and 7')]);
    assert.equal(code, 1);
    assert.match(stderr, /cannot read the line list "lines 3 and 7"/);
  });

  it('reports the problems of all items at once', () => {
    const { stderr } = run([item('frontend/src/a.ts', 'run', '4'), item('frontend/src/b.ts', 'start', '1')]);
    assert.match(stderr, /a\.ts run: none[\s\S]*b\.ts start: none/);
  });

  it('fails when the package has no lcov.info', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'gaps.json'), '{}');
    const { code, stderr } = runScript('local/gap-lines.ts', ['--out', dir, '--package', 'frontend'], { cwd: dir });
    assert.equal(code, 1);
    assert.match(stderr, /no lcov\.info \(looked in frontend\/coverage\/report\/lcov\.info, frontend\/coverage\/lcov\.info\)/);
  });
});
