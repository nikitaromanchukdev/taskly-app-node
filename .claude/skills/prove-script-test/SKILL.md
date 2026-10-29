---
name: prove-script-test
description: Prove that new or changed tests in .github/scripts/tests catch what they claim, by breaking each defence on purpose, confirming a test fails, and restoring the code. Use after writing or changing a script test, before the owner's review, or when asked "do these tests catch anything", "deliberate break", "mutation check for the scripts". For app tests (backend, frontend), Stryker covers this instead.
allowed-tools:
  - Bash(node --test:*)
  - Bash(git diff:*)
  - Bash(git show:*)
  - Bash(git status:*)
  - Read
  - Edit
---

# Prove Script Test

Break each defence a script test covers, see the test fail, then restore. The result goes in the PR's Evidence.

**The #1 rule:** restore every break before you finish, and check `git diff` shows only the intended change. **Why:** a forgotten break ships a broken guard or sanitizer, which are the workflow's injection defences.

## Before Starting

| Input | Default | Notes |
|---|---|---|
| `{test file}` | `git diff --name-only origin/main -- .github/scripts/tests/` | one at a time |
| `{script}` | the `import` or `runScript` target of each test file | path under `.github/scripts/`, e.g., `agent/guard.ts` |
| `{name}` | the file name of `{script}`, e.g., `guard.ts` | |

---

## Step 1: List the Defences

For each test file, list the behaviours its tests pin: one row per defence, e.g., "hook blocks a symlinked folder", "a not-run note links its ADR".

---

## Step 2: Save the Fixed Versions

```bash
mkdir -p {scratchpad}/fixed && cp .github/scripts/{script} {scratchpad}/fixed/{name}
```

---

## Step 3: Break, Run, Record

For each defence, one at a time:

1. **Break it** - the smallest edit that removes the defence: delete a check, flip a comparison, return early. For a bug fix, the break is the version before the fix: `git show origin/main:.github/scripts/{script} > .github/scripts/{script}`.
2. **Run** - `node --test {test file} 2>&1 | grep -E "^ℹ (pass|fail)|^✖ "`.
3. **Record** - the failing test names, or "not caught".
4. **Restore** - `cp {scratchpad}/fixed/{name} .github/scripts/{script}`.

The spec reporter prints `ℹ fail {n}` and `✖ {test}`, not TAP's `# fail`.

**If a break is not caught:**

| If | Then |
|---|---|
| The break changes no behaviour (equivalent, e.g., a redundant `startsWith('..')` after path resolution) | Record it as equivalent, with why |
| It changes behaviour | Add or fix a test, then repeat this step |

---

## Step 4: Confirm the Restore

```bash
git diff --stat
node --test '.github/scripts/tests/*.test.ts' 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

**Gate — stop here:** if `git diff` shows a change you did not intend, or any test fails → restore from `{scratchpad}/fixed/` and run again.

---

## Output Format

Lead with the count. Paste it into the PR's Evidence:

```markdown
{caught} of {total} breaks caught.

| Break | Failing tests |
|---|---|
| {defence removed} | {n}: {test names} |
| {equivalent break} | none (equivalent: {why}) |
```
