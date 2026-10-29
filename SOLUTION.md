# Solution: PR test engineer

For reviewers: what this repo adds, how to run it, what to set up, and what is still open.

This repo adds two ways to get tests written, both by the same agents and skills:

- **PR workflow:** adds or updates tests for the Units a PR changes. GitHub Actions runs it on every PR.
- **Backfill:** adds tests for existing, untested code, in one pass. The owner runs it locally: the Author, then the Reviewer, as in a PR run. The results go in the PR description, because the PR workflow has nothing to test on a PR that only adds tests. See [ADR 0008](docs/adr/0008-run-the-backfill-locally-and-report-it-in-the-pr-description.md).

## Key decisions

| Decision | ADR |
|---|---|
| Agents run in Claude Code through `claude-code-action` | [0001](docs/adr/0001-use-claude-code-action-as-agent-runtime.md) |
| Test changed Units only; write test files only | [0002](docs/adr/0002-test-changed-units-and-write-only-tests.md) |
| Expectations come from Intent sources; failing tests become Defects; a second agent reviews them | [0003](docs/adr/0003-derive-expectations-from-intent-and-review-defects.md) |
| PR code never runs next to the model key; agent config comes from the base branch | [0004](docs/adr/0004-isolate-pr-code-from-secrets.md) |
| Merge gate on `test-agent/verify`, with a `skip-test-agent` label | [0005](docs/adr/0005-gate-merges-on-test-agent-verify.md) |
| Budgets are admin-only repo variables, with no defaults; agents skip draft PRs | [0006](docs/adr/0006-set-budgets-as-admin-only-repo-variables.md) |
| Found bugs appear as review comments on the changed code (in the Backfill, one PR comment), each with a suggested fix that a person applies (proposed) | [0007](docs/adr/0007-report-defects-next-to-the-code-with-a-suggested-fix.md) |
| The Backfill runs locally and reports in its PR description; on a PR that changes only tests, the agent comments say why the agents did not run | [0008](docs/adr/0008-run-the-backfill-locally-and-report-it-in-the-pr-description.md) |

## How to run the PR workflow

- **Automatic.** The workflow `pr-test-engineer` runs when a PR is opened, reopened, marked ready for review, or pushed to. Adding or removing the `skip-test-agent` label also triggers it. Draft PRs get verification but no agent run, so model tokens are spent only once the author marks the PR ready. See [ADR 0006](docs/adr/0006-set-budgets-as-admin-only-repo-variables.md).
- **Re-run on the current head.** The run reads the live PR, so it analyses the head as it is now:

  ```sh
  gh workflow run pr-test-engineer.yml -f pull-request=<n>
  ```

  Use this after a failed run, after a budget variable changes, or after a cancelled run. It fails on a fork PR.
- **Locally.** `make trial` runs the same steps on your branch. Its prerequisites and the other local commands are in [AGENTS.md](AGENTS.md).
- **Concurrency.** A newer push cancels the older run for the same PR. Label events other than `skip-test-agent` run in their own group, so they cannot cancel a real run.

Results appear as one status (`test-agent/verify`) and three PR comments, plus review comments on the code for each Defect and Suspected Defect. On a PR that changes only tests and config, such as a Backfill PR, the agent comments say why the agents did not run: there is nothing new to test, and a Backfill PR lists its agent results in its description ([ADR 0008](docs/adr/0008-run-the-backfill-locally-and-report-it-in-the-pr-description.md)). How to read them is in [AGENTS.md](AGENTS.md).

## Prerequisites

The script `scripts/setup-github.sh` does the setup below. It needs `gh` and `jq`, and `gh` must be logged in as a repo admin.

```sh
scripts/setup-github.sh config     # steps 1 to 3 and a reminder for step 5
scripts/setup-github.sh ruleset    # step 4, then a read-back check
```

The same steps with raw `gh` commands:

1. **Model secret.** Either `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`.

   ```sh
   gh secret set ANTHROPIC_API_KEY
   ```

2. **Five repo variables.** Budgets, with no defaults. A run fails in `prepare` if one is missing or invalid. See [ADR 0006](docs/adr/0006-set-budgets-as-admin-only-repo-variables.md).

   ```sh
   gh variable set TEST_AGENT_MODEL --body '<model id>'
   gh variable set TEST_AGENT_REVIEWER_MODEL --body '<model id>'
   gh variable set TEST_AGENT_MAX_TURNS --body '<positive integer>'
   gh variable set TEST_AGENT_TIMEOUT_MINUTES --body '<positive integer>'
   gh variable set TEST_AGENT_MAX_ATTEMPTS --body '<positive integer>'
   ```

   An optional sixth variable, `TEST_AGENT_SKIP_ACTORS`, is a fallback for the skip label. See [ADR 0005](docs/adr/0005-gate-merges-on-test-agent-verify.md).

3. **Skip label.**

   ```sh
   gh label create skip-test-agent --force --color ededed
   ```

4. **Merge gate.** The ruleset is in `.github/rulesets/main.json`. Apply it after the workflow is merged to `main`. Before that, a PR whose branch lacks the workflow waits for a status that nothing posts.

   ```sh
   name=$(jq -r .name .github/rulesets/main.json)
   id=$(gh api repos/OWNER/REPO/rulesets --jq ".[] | select(.name == \"$name\") | .id")
   if [ -n "$id" ]; then
     gh api -X PUT "repos/OWNER/REPO/rulesets/$id" --input .github/rulesets/main.json
   else
     gh api -X POST repos/OWNER/REPO/rulesets --input .github/rulesets/main.json
   fi
   gh api repos/OWNER/REPO/rules/branches/main    # read-back: check the pull request, status and force-push rules
   ```

5. **Monthly spend limit.** Set it in the model provider's console, at `https://console.anthropic.com/settings/limits`. This is the hard cap on money.

## Agents, skills and the workflow

- **Agents.** `.claude/agents/pr-test-engineer.md` (the Author) and `.claude/agents/pr-test-reviewer.md` (the Reviewer).
- **Skills.** `.claude/skills/`, one folder per skill: `scope-change`, `map-coverage-gaps`, `extract-intent`, `author-tests`, `prove-tests` and `review-tests`. The package playbooks are `author-tests/backend.md` and `author-tests/frontend.md`.
- **Settings.** `.claude/agent-settings.json` holds the tool allow and deny lists and the write-guard hook. Every agent run receives it; see [ADR 0001](docs/adr/0001-use-claude-code-action-as-agent-runtime.md).
- **Rules, schemas and scripts.** `.github/scripts/`. These run without a model and are the source for the rules, the output schemas and the status decision.
- **Workflow.** `.github/workflows/pr-test-engineer.yml`. It wires the jobs below.

| Job | Runs a model | Write access | Runs PR code | What it does |
|---|---|---|---|---|
| `prepare` | no | commit status | no | Reads the live PR. Checks the budget variables. Writes `scope.json`. Sets the status to pending. |
| `engineer` | yes: Author, then Reviewer | none (read-only token) | only in containers | Restores base-branch config. Installs dependencies in the sandbox. Runs the agents. Saves `author.json`, `reviewer.json` and `tests.patch`. |
| `commit` | no | repo contents | no | Checks the patch and the agent output. Drops test files with blocking Findings, and new files that hold a flagged Defect's test. Pushes the Bot commit. |
| `verify` | no | none (read-only token) | yes, on the host, with no secrets | Typecheck and suites with coverage on the final commit, and the tests of the workflow's own scripts. Mutation testing for information only. |
| `publish` | no | commit status, PR comments | no | Decides the status. Renders the three comments, the review comments on the code, and the job summary. |

Agents never post. Only `prepare` (the pending status) and `publish` (the final status and the comments) post to the PR. `commit` pushes the Bot commit.

## Example run

Demo PR [#19](https://github.com/nikitaromanchukdev/taskly-app-node/pull/19) adds todo stats: `GET /api/todos/stats` with open, completed, per-priority and overdue counts, and header counters in the frontend. Its description states the intended behaviour, including "A todo due today is not overdue." The first push plants a defect: the overdue check uses `<=` instead of `<`.

Both runs used the same skills. The Author ran `scope-change`, `extract-intent`, `author-tests` and `prove-tests`; the Reviewer ran `review-tests`.

| | Push 1: planted defect | Push 2: fix |
|---|---|---|
| Run | [40778549704](https://github.com/nikitaromanchukdev/taskly-app-node/actions/runs/40778549704) | [40781735968](https://github.com/nikitaromanchukdev/taskly-app-node/actions/runs/40781735968) |
| Analyzed → Bot commit | `e4fb581` → `99f2945` | `dfb8adf` → `88233e6` |
| Verdicts (11 Units) | 6 `added`, 3 `amended`, 1 `flagged-defect`, 1 `not-needed` | 1 `amended`, 10 `not-needed` (already covered) |
| Bot commit | 8 test files, +215 lines | 1 test in `backend/tests/stats.test.ts` |
| Defect | `computeTodoStats` counts a todo due today as overdue: expected 0, received 1. The Reviewer confirmed it, quoting the PR description. The failing test was left out of the Bot commit. | none |
| Suites | backend 57, frontend 26, all pass | backend 58, frontend 26, all pass |
| Mutation (information only) | backend 60.7%, frontend 43.6% | backend 62.6%, frontend 43.6% |
| `test-agent/verify` | 🔴 1 confirmed defect: merge blocked | 🟢 merged |

Between the pushes, the author ran `git pull --rebase` to take the Bot commit, then changed `<=` to `<`. In push 2 the Author added the due-today test the first run could not commit, and marked the other Units as covered by the tests from push 1. Each run updated the same three comments in place. Each Bot commit left a PR run waiting for approval, which skips every job.

## Backfill run

The Backfill ran once per package. The Author used `map-coverage-gaps`, then the owner approved the gap list, then `extract-intent`, `author-tests` and `prove-tests`. The Reviewer then ran `review-tests` in a fresh session, twice per package: on the Author's tests, and again after the owner decided each Finding and edited the tests. Each PR description holds the full results.

| | Backend [#24](https://github.com/nikitaromanchukdev/taskly-app-node/pull/24) | Frontend [#25](https://github.com/nikitaromanchukdev/taskly-app-node/pull/25) |
|---|---|---|
| Units | 6 tested, 1 `not-needed` (unreachable) | 19 tested, 3 `not-needed` |
| Lines, before → after | 40.16% → 86.06% | 61.25% → 99.37% |
| Branches, before → after | 40.74% → 94.44% | 45.39% → 96.45% |
| Mutation, local Stryker on the backfilled files | 68.71% | 94.57% |
| Reviewer Findings | 4, all advisory; all fixed | 4, all advisory; 3 fixed, 1 disputed |
| Defects | none confirmed; 2 Suspected Defects, decided below | none confirmed; 2 Suspected Defects, decided below |
| `test-agent/verify` | 🟢 suites pass | 🟢 suites pass |

Per-file coverage floors keep each backfilled file at the level it reached.

The owner decided each Suspected Defect. The details are in each PR's Defects comment.

| Suspected Defect | Owner decision |
|---|---|
| Backend: `/api/health` answers a database failure with the generic 500 body | Kept on purpose: the client gets no detail about why the server failed. |
| Backend: body-parser client errors other than bad JSON and too-large bodies return 500 | Kept as is: fixing app code is outside this task, which only adds tests. |
| Frontend: the overdue badge uses the local date, while the overdue counter uses the UTC date | Kept on purpose, see [limitations](#assumptions-and-limitations). |
| Frontend: a 422 shows the fixed input-limits message and ignores the server's `detail` | Kept on purpose: the server's validation messages are not written for users. |

## Assumptions and limitations

Assumptions:

- One maintainer, who is a repo admin. No review approvals are required.
- The repo is on GitHub with Actions enabled and a hosted Ubuntu runner, which has Docker.
- The model key is an Actions secret, and the spend limit is set in the console.
- The Intent sources are correct. The workflow cannot check them.
- The ruleset's status check is taken from GitHub Actions (integration 15368). This has not been proven on a live repo. If the gate does not accept the status, remove `integration_id` from `.github/rulesets/main.json`, run the ruleset step again, and open a follow-up PR.

Limitations:

- A blocking Finding removes the whole test file from the Bot commit, including its good tests.
- Each Bot commit leaves a PR run waiting for approval, because GitHub holds runs started by a `GITHUB_TOKEN` push. The run skips every job. Pushing with a GitHub App token would remove the prompt, but would also start a full run on the Bot commit.
- The Author does not always follow procedure. In the demo runs it used shell commands its tool rules deny (`cat`, `sed`, `cd …;`) and retried with the right tools, which costs turns. Earlier runs ignored the skill's instructions for removing a Defect's failing test, so `commit` now drops a new file that still holds one.
- The agents' summaries are free text. One named a Unit by a name that does not exist in the code, while the Units table was correct. Read the tables, not only the summary.
- The Reviewer is also a model. It lowers the rate of false Defects; it does not remove them.
- A same-repo writer can edit the workflow file in a PR. PR runs use the head copy of the workflow, so the budgets and the guard steps in it can be changed. The team mitigation is CODEOWNERS on `.github/` and `.claude/`, with a ruleset that requires code-owner review. It is not applied, because the sole maintainer cannot approve their own PRs.
- Fork PRs get no agent run and no status. The branch must be pushed into the repo to merge.
- No CI run proves a Backfill's agent results. Its PR description is written by hand from the local `author.json` and `reviewer.json`, so it can drift from them ([ADR 0008](docs/adr/0008-run-the-backfill-locally-and-report-it-in-the-pr-description.md)).
- The script tests cover the scripts that decide what reaches the PR: `guard.ts`, `sanitize.ts`, `agent-output.ts` and `status.ts`. The scripts that call GitHub (`prepare.ts`, `context.ts`, `report.ts`) have no tests.
- The output types in `agent-output.ts` repeat the schema enums by hand, so they can drift from the schemas.
- The mutation score is reported, not enforced.
- The overdue badge and the overdue counter can disagree around midnight. `due_date` is a calendar date with no time or offset, so the badge compares it with the user's local date and the counter with the UTC date. Left as is on purpose: the fix changes the data model, outside this task.
- Some acceptance checks were not run on the live repo: the `skip-test-agent` label (honoured, and ignored for a user without maintain rights), a `workflow_dispatch` re-run, and a crafted tautological test that a blocking Finding drops from the Bot commit.
- The final status waits for mutation testing to finish, within an 8-minute limit per package.
- A PR that changes `.claude/` or `.github/` cannot test its own agent config, because the run uses the base copy.
- `verify` runs the PR's own test setup: `npm ci` with install scripts, the vitest configs, setup files and tests. That code runs on the runner host, without secrets and with a read-only token, and it can write its own results files or make its own suites pass. This holds for CI in general. The control is a human reading the diff. Running `verify` through the sandbox and CODEOWNERS on the run config are production items.
- PR code in the sandbox can still write files the Author may read, such as a nested `CLAUDE.md` in a test folder. That is prompt injection, not code execution: the Author has no network tools and its Bash is limited to git reads and `sandbox.sh`.

## Production version

Items a production version would add:

- An interactive setup wizard with guided steps, links to the console pages, and a summary of skipped steps, in place of the plain setup script.
- Run modes and triggers, read from the base branch. For example, a strict mode with a local pre-push hook, and a manual trigger by label.
- Optional human approval before the Bot commit, through a GitHub Environment with required reviewers.
- Container isolation for every job that runs PR code, with no host fallback. This includes `verify`.
- CODEOWNERS on `.github/`, `.claude/` and the test run config (`**/package.json`, the vitest and vite configs, test setup files), with a ruleset that requires code-owner review. This needs a team.
- The mutation score as a gate on changed files.
- One bounded revise round after review: the Author fixes the flagged tests, a narrow final review runs, and only then are blocked tests dropped. This replaces dropping whole files.
- Tests for the scripts that call GitHub, against a fake API.
- A fork PR flow, where a maintainer applies a label to start a run.
- A check for gaps in the lines a PR touches, reported as a separate required check.
- Budgets and config read from the base branch only.
- Cost telemetry for each run.
- The due moment stored as a UTC instant (`timestamptz`), so the badge and the counter both check `now > due` and agree.
- An identical local run of the PR workflow, as a single entry point.
- API smoke tests against Postgres, and a frontend build, in `verify`.
- Citation checks on the Intent sources in the tests.
- A script that renders a Backfill PR description from `author.json` and `reviewer.json`.
