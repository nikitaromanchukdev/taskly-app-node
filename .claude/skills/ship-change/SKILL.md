---
name: ship-change
description: Take a change in this repo from a fresh branch to an open PR - branch or worktree, the checks that match the files changed, the owner's review, a Conventional commit, push, and cleanup after the merge. Use when starting a change, before committing, or after a PR merges, e.g. "start a branch for", "commit this", "push", "is it ready", "clean up after merge", "base this on the open PR". The PR itself is opened with github-ops.
allowed-tools:
  - Bash(git status:*)
  - Bash(git diff:*)
  - Bash(git log:*)
  - Bash(git fetch:*)
  - Bash(git worktree list:*)
  - Bash(node --test:*)
  - Bash(make script-tests:*)
  - Read
---

# Ship Change

Branch, check, get the owner's review, commit, push, and clean up, in this repo's conventions.

**The #1 rule:** never commit before the owner has reviewed the diff, unless the owner said otherwise for this change. **Why:** the owner reviews every change before it enters history; this rule is standing.

## Before Starting

| Input | Default | Notes |
|---|---|---|
| Issue number | from the task; ask if none | Branch `feat/issue-{n}-{slug}` |
| Base | `origin/main` | Another PR's branch only when the change needs code that is not merged yet, see Step 1 |
| Worktree | no | Yes when another change is open in the main checkout |

---

## Step 1: Branch

```bash
git fetch -q origin
git switch -c feat/issue-{n}-{slug} origin/main
git branch --unset-upstream    # it must not track main, or a bare push targets main
```

**If the change needs an unmerged PR's code:** use `origin/{that branch}` as the base and say so in the PR body. After that PR merges, move the work onto `main`:

```bash
git fetch -q origin
git switch -C feat/issue-{n}-{slug} origin/main   # uncommitted changes come along if the merged files match
```

**If using a worktree:**

```bash
git worktree add .claude/worktrees/{slug} -b feat/issue-{n}-{slug} origin/main
```

The git stash is shared by all worktrees. NEVER use a bare `git stash` / `git stash pop`. **Why:** another session's stash can be popped instead of yours; set work aside with a WIP commit.

---

## Step 2: Run the Checks for What Changed

Run every row that matches the diff (`git diff --stat origin/main`):

| If the diff touches | Run | Pass |
|---|---|---|
| `backend/` | `npm test` and `npm run typecheck` in `backend/` | all pass |
| `frontend/` | `npm test` and `npm run typecheck` in `frontend/` | all pass |
| `.github/scripts/` | `make script-tests` and `backend/node_modules/.bin/tsc -p .github/scripts` | all pass, no output from `tsc` |
| a new or changed test in `.github/scripts/tests/` | the `prove-script-test` skill | each break caught |
| `.claude/agents/`, the agents' skills, `.claude/agent-settings.json`, `.github/scripts/` | `make demo` (uses model tokens; the owner runs it) | `demo: PASS`, pasted into the PR's Evidence |

**In a worktree**, `tsc` cannot find the Node types. Point it at the main checkout:

```bash
backend/node_modules/.bin/tsc -p .github/scripts --typeRoots {main checkout}/backend/node_modules/@types
```

**Gate — stop here:** if any check fails → fix it or report the output. Never describe a failing check as passing.

**Why `make demo` for agent config:** the PR's own run uses `main`'s copy of the agent config (ADR 0004), so the demo is the only test of the new config before the merge.

---

## Step 3: Stop for the Owner's Review

Show `git status --short` and `git diff --stat`, a short summary of each change, and the check results. Then wait.

> "Review the diff, then I'll commit and push."

---

## Step 4: Commit

Stage named files only, never `git add -A`. **Why:** `.test-agent/`, scratch files, and other sessions' work must not land in the commit.

```bash
git add {files}
git commit -F - <<'EOF'
{type}({scope}): {what, imperative, lower case}

{why, wrapped at 72}

Part of #{n}

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

| Part | Rule |
|---|---|
| `type` | `feat`, `fix`, `test`, `docs`, `refactor`, `chore` |
| `scope` | `backend`, `frontend`, `scripts`, `workflow`, `agents`, `skills`, `solution`, … |
| Issue line | `Closes #{n}` when the PR finishes the issue, else `Part of #{n}` |

---

## Step 5: Push and Open the PR

```bash
git push -u origin feat/issue-{n}-{slug}
```

Then open the PR with the `github-ops` skill.

- **Draft while iterating** - on a draft PR the agents don't run; mark it ready when the change is done.
- **After a Bot commit** - run `git pull --rebase` before the next push, or the push is rejected.

---

## Step 6: Clean Up After the Merge

Only after the owner says the PR is merged:

```bash
git fetch -q origin
gh pr view {pr} --json state --jq .state          # must print MERGED
git worktree remove .claude/worktrees/{slug}      # if a worktree was used
git branch -D feat/issue-{n}-{slug}
git switch main && git pull -q --ff-only
```

**Merge order:** when PRs depend on each other, name the order to the owner before they merge. **Why:** a later PR merged first fails or carries the earlier PR's diff.

---

## Checklist

- [ ] Branch name `feat/issue-{n}-{slug}`, not tracking `main`
- [ ] Every matching check in Step 2 ran and passed
- [ ] Owner reviewed before the commit
- [ ] Commit has a scope, the issue line, and the trailer
- [ ] Worktree and branch removed after the merge
