// rules.ts sorts each changed file into a candidate or a skip. ignored-paths.json adds the owner's own skips.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';
import { classify, IGNORED_PATHS, readIgnoredPaths } from '../contracts/rules.ts';
import type { IgnoredPaths } from '../contracts/rules.ts';
import { tempDir } from './run.ts';

const DESIGN_SYSTEM: IgnoredPaths = { package: 'frontend', paths: ['src/design-system/**'], reason: 'Shown in Storybook.' };

const fileWith = (value: unknown): URL => {
  const path = join(tempDir(), 'ignored-paths.json');
  writeFileSync(path, JSON.stringify(value));
  return pathToFileURL(path);
};

describe('classify with ignored paths', () => {
  it("skips a source file under an ignored path as ignored, with the owner's reason", () => {
    assert.deepEqual(classify('frontend/src/design-system/components/Button.tsx', [DESIGN_SYSTEM]), {
      kind: 'skip',
      reason: 'ignored',
      note: 'Shown in Storybook.',
    });
  });

  it('keeps a source file outside the ignored paths a candidate', () => {
    assert.deepEqual(classify('frontend/src/features/todos/TodosPage.tsx', [DESIGN_SYSTEM]), { kind: 'candidate', package: 'frontend' });
  });

  it("matches an ignored path only in its own package", () => {
    assert.deepEqual(classify('backend/src/design-system/x.ts', [DESIGN_SYSTEM]), { kind: 'candidate', package: 'backend' });
  });

  it('applies built-in rules first, so a story under an ignored path stays a story', () => {
    assert.deepEqual(classify('frontend/src/design-system/Button.stories.tsx', [DESIGN_SYSTEM]), { kind: 'skip', reason: 'stories' });
  });

  it('keeps a test file under an ignored path a test', () => {
    assert.deepEqual(classify('frontend/src/design-system/Button.test.tsx', [DESIGN_SYSTEM]), { kind: 'skip', reason: 'tests' });
  });

  it('uses the committed ignored-paths.json by default', () => {
    const entry = IGNORED_PATHS.find((item) => item.package === 'frontend');
    assert.ok(entry, 'the committed file ignores a frontend path');
    assert.equal(classify(`frontend/${entry.paths[0].replace('**', 'x.tsx')}`).kind, 'skip');
  });
});

describe('readIgnoredPaths', () => {
  it('reads a valid file', () => {
    assert.deepEqual(readIgnoredPaths(fileWith({ ignored: [DESIGN_SYSTEM] })), [DESIGN_SYSTEM]);
  });

  it('refuses an entry without a reason, so no path is ignored silently', () => {
    assert.throws(() => readIgnoredPaths(fileWith({ ignored: [{ package: 'frontend', paths: ['src/**'] }] })), /reason: required/);
  });

  it('refuses an unknown package', () => {
    assert.throws(() => readIgnoredPaths(fileWith({ ignored: [{ ...DESIGN_SYSTEM, package: 'docs' }] })), /not one of backend\|frontend/);
  });
});
