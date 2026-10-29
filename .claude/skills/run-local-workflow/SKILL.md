---
name: run-local-workflow
description: Run this repo's local make commands for the user - make trial (the PR workflow's agents on the current branch), make demo (the agent config against a planted Defect, PASS or FAIL), the Backfill (make backfill-gaps, backfill-approve, backfill-tests), make hook-demo, make clean, single steps - including the setup each needs, and summarize the result. Use when the user wants to try the agents locally, test a change before opening a PR, check that changed agents or skills still work, run a Backfill, see the write guard block an edit, or clean up local output, e.g. "run the trial", "run the demo", "run the backfill for frontend", "does the new skill still catch the defect", "test this locally", "clean test-agent". For CI runs on a PR, use github-ops.
allowed-tools:
  - Bash(make -n:*)
  - Bash(node .github/scripts/local/trial.ts dir:*)
  - Bash(git status:*)
  - Bash(git log:*)
  - Bash(docker info:*)
  - Read
  - AskUserQuestion
---

# Run Local Workflow

Set up and run the Makefile's local commands for the user, then report what they produced. Nothing is pushed or posted.

**The #1 rule:** never write the intended behaviour yourself. It comes from the user, the open PR, or the commit messages, word for word. **Why:** text derived from the code states what the code does, so the agents could never find a Defect against it (ADR 0003).

## Before Starting

Map the request to a command:

| The user wants | Command | Uses model tokens |
|---|---|---|
| Run the agents on the committed change of this branch | `make trial` | yes |
| Check that the agent config on disk still catches a known Defect and blocks a known tautology | `make demo` | yes |
| See the write guard block an edit to source code | `make hook-demo` | yes, a little |
| Find and rank the coverage gaps of one package (Backfill, part 1) | `make backfill-gaps PACKAGE={package}` | yes |
| Pick or change the approved gaps, and decline others | `make backfill-approve PACKAGE={package} APPROVE={items} [DECLINE={items} REASON="{why}"]` | no |
| Test the approved gaps and review the tests (Backfill, part 2) | `make backfill-tests PACKAGE={package}` | yes |
| Record the Backfill's decided gaps, once its PR is open | `make backfill-record PACKAGE={package} PR={n}` | no |
| Repeat one step of the last trial | `make {scope\|intent\|install\|author\|patch\|review\|check\|report}` | `author`, `review` only |
| Run the workflow scripts' own tests | `make script-tests` | no |
| Remove local output | `make clean` | no |

| Input | Default | Notes |
|---|---|---|
| Base | `main` | pass `BASE={branch}` only when the user names one |
| Models, turns, attempts | the Makefile's defaults | override per run, e.g. `TEST_AGENT_MODEL=claude-haiku-5-5` |

---

## Step 1: Check Prerequisites

```bash
command -v claude jq rsync node && node --version && docker info > /dev/null && echo docker ok
```

| If | Then |
|---|---|
| `node` is below v24 | stop: the scripts need Node 24 |
| `docker info` fails | ask the user to start Docker, wait for "done". Do not start it yourself |
| `claude`, `jq` or `rsync` missing | name the missing tool and stop |

---

## Step 2: Confirm the Cost

**If the command uses model tokens:** ask before running. Each trial or demo is two agent runs on the user's login.

```
Use AskUserQuestion with:
- question: "Run make {command}? It uses model tokens and takes several minutes."
- header: "Confirm"
- options:
  1. "Run (Recommended)" - default models from the Makefile
  2. "Run with Haiku" - cheaper, less reliable; for a quick smoke check
```

**If "Run with Haiku"** → prefix the command with `TEST_AGENT_MODEL=claude-haiku-5-5 TEST_AGENT_REVIEWER_MODEL=claude-haiku-5-5`.

---

## Step 3: Prepare the Run

### Path A: `make trial`

1. **Check the working tree** - `git status --short`.

   **Gate — stop here:** if anything is uncommitted → do NOT commit it. **Why:** the user reviews every commit. Offer:
   - commit it through the `ship-change` skill, then come back;
   - or `make demo`, which tests the agent config on disk without a commit, if that is what they want to check.

2. **Find the output folder** - `node .github/scripts/local/trial.ts dir` (e.g., `.test-agent/feat-issue-5-x`).
3. **Settle the intent** - if `{folder}/pr-body.md` exists, read its first line and tell the user it will be reused. Otherwise ask:

   ```
   Use AskUserQuestion with:
   - question: "Where should the intended behaviour come from?"
   - header: "Intent"
   - options:
     1. "Open PR description" - only if `gh pr view --json title,body` finds one
     2. "Commit messages" - only if `git log {base}..HEAD --format=%B` has text
     3. "I'll describe it" - the user types it in their next message
     4. "None" - Defects then come only from openapi.json, existing tests or docs
   ```

   Write the chosen text unchanged to `{folder}/pr-body.md`. **If "None"** → write an empty file. Make's own intent menu needs a terminal, which you don't have, so this file replaces it.

### Path B: `make demo`

No preparation. It runs every case in `.github/agent-tests/` against the agent config as it is on disk; `CASE={name}` runs one. The `tautology` case is review-only: one Reviewer run, no Author run.

### Path C: `make clean`

Run `node .github/scripts/local/trial.ts dir`. **If that folder does NOT exist:** `make clean` only lists the other folders, because it has no terminal to ask. Ask the user which one, then run `make clean OUT=.test-agent/{folder}`.

### Path D: The Backfill

1. **Check the working tree** - as in Path A; `tests.patch` must hold only the Author's tests.
2. **Package** - never default it. Ask: `backend` or `frontend`. One package per run and per PR.
3. **Part 1** - run `make backfill-gaps PACKAGE={package}`. Without a terminal it ends with "not approved yet": that is expected, not a failure.
4. **Approve** - show the user `{folder}/gaps.md`, then ask which Recommendations to approve, by number, `all` or `none`, and which of the others to decline as not worth testing, with one reason. Free text: ask in the reply, not with options. Gaps under **Decided earlier** are already left out. Then run:

   ```bash
   make backfill-approve PACKAGE={package} APPROVE={1,3|all|none} DECLINE={2,4} REASON="{reason}"
   ```

   Leave out `DECLINE` and `REASON` when the user declines nothing. One `REASON` covers every item in `DECLINE`, and each run replaces `declined.json`. For a reason per item, ask the user to run `! make backfill-approve PACKAGE={package}` on a terminal: it asks for each one.

5. **Part 2** - after approval, confirm the cost (Step 2), then run `make backfill-tests PACKAGE={package}`.

Never approve items yourself. **Why:** the owner decides what the Backfill tests (ADR 0008).

---

## Step 4: Run

Run the command in the background, so a long run does not hit the shell timeout, and say so:

> "Running make {command} in the background. First runs install dependencies in Docker; expect several minutes."

**If the sandbox blocks Docker or the nested `claude` call:** do not retry another way. Ask the user to run it themselves: `! make {command}`.

---

## Step 5: Read the Result

| Command | Read | Success |
|---|---|---|
| `make trial` | `{folder}/report.md`, `author.md`, `reviewer.md`, `checked.json` | `checked.json` has `"ok": true` |
| `make demo` | the `== demo case:` sections of the output, then `.test-agent/demo/{case}/` | `trial: demo PASS` for every case |
| `make backfill-gaps` | `{folder}/gaps.md` | the three lists and **Decided earlier** are there |
| `make backfill-tests` | `{folder}/author.md`, `reviewer.md`, `checked.json`, `coverage-before.json`, `coverage-after.json` | `checked.json` has `"ok": true` |
| `make hook-demo` | the output | `hook-demo: backend/src unchanged` |
| `make script-tests` | `ℹ pass` and `ℹ fail` lines | `ℹ fail 0` |

- **"Verification did not finish"** in a local `report.md` is expected: coverage and mutation run only in CI.
- **A failed step** - make names it (e.g., `make: *** [check] Error 1`). Quote that line and the last error lines of the step, not the whole log.
- **`demo: FAIL`** - the listed mismatches say what the agents did differently. A changed skill is the likely cause when the demo passed on `main`.

---

## Output Format

Lead with the verdict:

```markdown
{✅ / ❌} make {command}: {PASS / FAIL / failed at {step}}

- Intent: {source, or "none"}
- Units: {Unit} → {Verdict}, ... ; Defects: {n flagged}, {n confirmed}
- Findings: {n blocking}, {n advisory}
- Output: {full path to the folder}
```

---

## Notes

- **Read-only on git** - this skill never commits, pushes, or switches branches.
- **Output** - `.test-agent/` is git-ignored. `make clean` keeps each branch's `pr-body.md`.
- **Agent-config PRs** - a `make demo` PASS belongs in the PR's Evidence (see `ship-change`).
