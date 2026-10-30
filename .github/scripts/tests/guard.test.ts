// guard.ts is the write guard: the agent may write only test files (rules.ts).
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runScript, tempDir } from './run.ts';

type ToolCall = { tool_name: string; tool_input: { file_path?: string; notebook_path?: string; command?: string } };
type BlockedCommand = { command: string; hint: RegExp };

// A project folder with the package layout, so symlinks and relative paths resolve as in the repo.
function project(): string {
  const root = tempDir();
  for (const dir of ['backend/src', 'backend/tests', 'frontend/src/features']) mkdirSync(join(root, dir), { recursive: true });
  return root;
}

const hook = (root: string, call: ToolCall | string) =>
  runScript('agent/guard.ts', ['hook'], {
    input: typeof call === 'string' ? call : JSON.stringify({ ...call, cwd: root }),
    env: { CLAUDE_PROJECT_DIR: root },
  });

const write = (file_path: string): ToolCall => ({ tool_name: 'Write', tool_input: { file_path } });

describe('guard.ts hook', () => {
  for (const path of ['backend/tests/router.test.ts', 'backend/tests/fixture.ts', 'frontend/src/features/Item.test.tsx', 'frontend/src/test/setup.ts']) {
    it(`allows a write to the test path ${path}`, () => {
      assert.equal(hook(project(), write(path)).code, 0);
    });
  }

  for (const path of ['backend/src/main.ts', 'frontend/src/features/Item.tsx', 'backend/package.json', '.github/scripts/agent/guard.ts', '.claude/agent-settings.json', 'CLAUDE.md']) {
    it(`blocks a write to the non-test path ${path} with exit 2`, () => {
      const result = hook(project(), write(path));
      assert.equal(result.code, 2);
      assert.match(result.stderr, /only test files may be written/);
    });
  }

  it('blocks a path that climbs out of the tests folder', () => {
    assert.equal(hook(project(), write('backend/tests/../src/main.ts')).code, 2);
  });

  it('blocks an absolute path outside the project', () => {
    assert.equal(hook(project(), write('/etc/backend/tests/x.test.ts')).code, 2);
  });

  it('blocks a write through a symlink in the tests folder that points at source code', () => {
    const root = project();
    symlinkSync(join(root, 'backend/src'), join(root, 'backend/tests/linked'));
    assert.equal(hook(root, write('backend/tests/linked/main.ts')).code, 2);
  });

  it('blocks a write to a symlinked file in the tests folder that points at source code', () => {
    const root = project();
    writeFileSync(join(root, 'backend/src/main.ts'), '');
    symlinkSync(join(root, 'backend/src/main.ts'), join(root, 'backend/tests/main.test.ts'));
    assert.equal(hook(root, write('backend/tests/main.test.ts')).code, 2);
  });

  for (const tool_name of ['Edit', 'MultiEdit']) {
    it(`guards ${tool_name} like Write`, () => {
      assert.equal(hook(project(), { tool_name, tool_input: { file_path: 'backend/src/main.ts' } }).code, 2);
    });
  }

  it('guards the notebook path of NotebookEdit', () => {
    assert.equal(hook(project(), { tool_name: 'NotebookEdit', tool_input: { notebook_path: 'backend/src/x.ipynb' } }).code, 2);
  });

  it('lets tools that write no file through', () => {
    assert.equal(hook(project(), { tool_name: 'Read', tool_input: { file_path: 'backend/src/main.ts' } }).code, 0);
  });

  it('blocks a write call with no file path', () => {
    assert.equal(hook(project(), { tool_name: 'Write', tool_input: {} }).code, 2);
  });

  it('blocks when the hook input is not JSON', () => {
    const result = hook(project(), 'not json');
    assert.equal(result.code, 2);
    assert.match(result.stderr, /not valid JSON/);
  });
});

const bash = (command?: string): ToolCall => ({ tool_name: 'Bash', tool_input: { command } });
const SANDBOX = '.github/scripts/agent/sandbox.sh';

// Each refused command must name the tool or form that replaces it, so the agent can correct itself.
const BLOCKED: readonly BlockedCommand[] = [
  { command: 'cat backend/src/main.ts', hint: /use Read/ },
  { command: '/bin/cat backend/src/main.ts', hint: /use Read/ },
  { command: 'head -50 backend/src/main.ts', hint: /use Read/ },
  { command: 'tail -n 20 backend/src/main.ts', hint: /use Read/ },
  { command: 'sed -n 1,40p backend/src/main.ts', hint: /use Read .* Edit/ },
  { command: 'grep -rn createTodo backend/src', hint: /use Grep/ },
  { command: 'find backend/src -name *.ts', hint: /Glob/ },
  { command: 'echo x > backend/tests/a.test.ts', hint: /redirects .* use Read, Write or Edit.*use Write or Edit/ },
  { command: 'git diff > out.patch', hint: /redirects/ },
  { command: 'git show HEAD:backend/src/main.ts < /dev/null', hint: /redirects/ },
  { command: 'git status; cat backend/src/main.ts', hint: /one command per call/ },
  { command: 'git diff && npm test', hint: /one command per call/ },
  { command: 'git diff || true', hint: /one command per call/ },
  { command: 'git log | head', hint: /one command per call/ },
  { command: 'git status &', hint: /one command per call/ },
  { command: 'git status\ncat backend/src/main.ts', hint: /one command per call/ },
  { command: 'git show $(cat ref)', hint: /command substitution/ },
  { command: 'git show `cat ref`', hint: /command substitution/ },
  { command: '(git status)', hint: /subshells/ },
  { command: 'git diff --output=x.patch', hint: /--output writes/ },
  { command: 'git diff --no-index /etc/passwd backend/src/main.ts', hint: /--no-index reads/ },
  { command: `cd backend && ${SANDBOX} test backend`, hint: /do not cd/ },
  { command: 'npm test', hint: /sandbox\.sh test\|typecheck/ },
  { command: `./${SANDBOX} test backend`, hint: /directly from the repo root/ },
  { command: `bash ${SANDBOX} test backend`, hint: /directly from the repo root/ },
  { command: `${SANDBOX} install backend`, hint: /sandbox\.sh test\|typecheck/ },
  { command: 'git push origin HEAD', hint: /only diff, log, show and status/ },
  { command: 'git difftool', hint: /only diff, log, show and status/ },
  { command: 'python3 -c 1', hint: /not allowed\. Allowed, one per call: git diff/ },
];

describe('guard.ts hook on Bash', () => {
  for (const command of [
    'git diff main...HEAD -- backend/src/main.ts',
    'git log --oneline -5',
    'git log --format="%h %s" -3',
    'git show HEAD:backend/src/main.ts',
    'git status',
    '  git status  ',
    `${SANDBOX} test backend backend/tests/router.test.ts`,
    `${SANDBOX} typecheck frontend`,
  ]) {
    it(`allows ${command}`, () => {
      const result = hook(project(), bash(command));
      assert.equal(result.code, 0, result.stderr);
    });
  }

  for (const { command, hint } of BLOCKED) {
    it(`blocks ${JSON.stringify(command)} with exit 2 and names what to use`, () => {
      const result = hook(project(), bash(command));
      assert.equal(result.code, 2);
      assert.match(result.stderr, hint);
    });
  }

  it('blocks a Bash call with no command', () => {
    const result = hook(project(), bash());
    assert.equal(result.code, 2);
    assert.match(result.stderr, /no command/);
  });
});

// A minimal git patch that adds one file.
const added = (path: string, mode = '100644') =>
  [`diff --git a/${path} b/${path}`, `new file mode ${mode}`, 'index 0000000..1111111', '--- /dev/null', `+++ b/${path}`, '@@ -0,0 +1 @@', '+x', ''].join('\n');

function checkPatch(patch: string) {
  const file = join(tempDir(), 'tests.patch');
  writeFileSync(file, patch);
  return runScript('agent/guard.ts', ['patch', file]);
}

describe('guard.ts patch', () => {
  it('accepts a patch that touches only test paths', () => {
    const result = checkPatch(added('backend/tests/a.test.ts') + added('frontend/src/x/B.test.tsx'));
    assert.equal(result.code, 0);
    assert.match(result.stdout, /patch ok/);
  });

  it('rejects a patch that also touches source code, and names the path', () => {
    const result = checkPatch(added('backend/tests/a.test.ts') + added('backend/src/main.ts'));
    assert.equal(result.code, 1);
    assert.match(result.stderr, /non-test path backend\/src\/main\.ts/);
  });

  it('rejects a rename from a test file to a source file', () => {
    const patch = [
      'diff --git a/backend/tests/a.test.ts b/backend/tests/a.test.ts',
      'similarity index 100%',
      'rename from backend/tests/a.test.ts',
      'rename to backend/src/a.ts',
      '',
    ].join('\n');
    assert.equal(checkPatch(patch).code, 1);
  });

  it('rejects a symlink, even in a test path', () => {
    const result = checkPatch(added('backend/tests/link.ts', '120000'));
    assert.equal(result.code, 1);
    assert.match(result.stderr, /creates symlink/);
  });

  for (const path of ['backend/tests/../src/main.ts', '/backend/tests/a.test.ts']) {
    it(`rejects the path ${path}`, () => {
      assert.equal(checkPatch(added(path)).code, 1);
    });
  }

  it('rejects a quoted path, which git uses for unusual characters', () => {
    const patch = ['diff --git "a/backend/tests/\\303\\244.ts" "b/backend/src/\\303\\244.ts"', ''].join('\n');
    assert.equal(checkPatch(patch).code, 1);
  });

  it('exits 64 without a patch file', () => {
    assert.equal(runScript('agent/guard.ts', ['patch']).code, 64);
  });
});
