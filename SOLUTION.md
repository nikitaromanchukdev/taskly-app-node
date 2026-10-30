# Solution: PR test engineer

For reviewers: what this repo adds, how to run it, what to set up, and what is still open.

This repo adds two ways to get tests written, both by the same agents and skills:

- **PR workflow:** adds or updates tests for the Units a PR changes. GitHub Actions runs it on every PR.
- **Backfill:** adds tests for existing, untested code, in one pass. The owner runs it locally with `make backfill-gaps` and `make backfill-tests`: the Author, then the Reviewer, as in a PR workflow. The results go in the PR description, because the PR workflow has nothing to test on a PR that only adds tests. See [ADR 0008](docs/adr/0008-run-the-backfill-locally-and-report-it-in-the-pr-description.md).

## Key decisions

| Decision | ADR |
|---|---|
| Agents run in Claude Code through `claude-code-action` | [0001](docs/adr/0001-use-claude-code-action-as-agent-runtime.md) |
| Test changed Units only; write test files only | [0002](docs/adr/0002-test-changed-units-and-write-only-tests.md) |
| Expectations come from Intent sources; failing tests become Defects; a second agent reviews them | [0003](docs/adr/0003-derive-expectations-from-intent-and-review-defects.md) |
| PR code never runs next to the model key; agent config comes from the base branch | [0004](docs/adr/0004-isolate-pr-code-from-secrets.md) |
| Merge gate on `test-agent/verify`, with a `skip-test-agent` label, and an admin bypass for PRs that cannot pass their own run | [0005](docs/adr/0005-gate-merges-on-test-agent-verify.md) |
| Budgets are admin-only repo variables, with no defaults; agents skip draft PRs | [0006](docs/adr/0006-set-budgets-as-admin-only-repo-variables.md) |
| Found bugs appear as review comments on the changed code (in the Backfill, one PR comment), each with a suggested fix that a person applies (proposed) | [0007](docs/adr/0007-report-defects-next-to-the-code-with-a-suggested-fix.md) |
| The Backfill runs locally and reports in its PR description; on a PR that changes only tests, the agent comments say why the agents did not run | [0008](docs/adr/0008-run-the-backfill-locally-and-report-it-in-the-pr-description.md) |
| A change to the agent config is tested before the merge with `make demo`, against committed cases (a planted Defect, a tautology) and their expected results | [0009](docs/adr/0009-test-agent-config-changes-against-committed-cases.md) |

## How to run the PR workflow

- **Automatic.** The workflow `pr-intake` runs from the PR when it is opened, reopened, marked ready for review, or pushed to, and when the `skip-test-agent` label is added or removed. When it ends, `pr-test-engineer` runs from the default branch. Fork PRs start neither. Draft PRs get verification but no agent run, so model tokens are spent only once the author marks the PR ready. See [ADR 0006](docs/adr/0006-set-budgets-as-admin-only-repo-variables.md).
- **Re-run on the current head.** The run reads the live PR, so it analyses the head as it is now:

  ```sh
  gh workflow run pr-test-engineer.yml -f pull-request=<n>
  ```

  Use this after a failed run, after a budget variable changes, or after a cancelled run. It is accepted only from `main`, and it stops on a fork PR.
- **Locally.** `make trial` runs the same steps on your branch, and asks for the intended behaviour the first time. `make demo` runs them on committed cases (a planted Defect, and a tautology the Reviewer must block) and prints PASS or FAIL; it is the check for a PR that changes the agent config, which its own PR run cannot test. Prerequisites and the other local commands are in [AGENTS.md](AGENTS.md).
- **Concurrency.** A newer push cancels the older run for the same PR. Label events other than `skip-test-agent`, and `pr-intake` runs that did not succeed, run in their own group, so they cannot cancel a real run. A dispatch is grouped by PR number and a push by branch name, so a dispatch does not cancel a run that a push started.

Results appear as one status (`test-agent/verify`) and three PR comments. Review comments on the code are proposed, not built ([ADR 0007](docs/adr/0007-report-defects-next-to-the-code-with-a-suggested-fix.md)). On a PR that changes only tests and config, such as a Backfill PR, the agent comments say why the agents did not run: there is nothing new to test, and a Backfill PR lists its agent results in its description ([ADR 0008](docs/adr/0008-run-the-backfill-locally-and-report-it-in-the-pr-description.md)). How to read them is in [AGENTS.md](AGENTS.md).

## Prerequisites

The script `scripts/setup-github.sh` does the setup below. It needs `gh` and `jq`, and `gh` must be logged in as a repo admin.

```sh
scripts/setup-github.sh config     # steps 1 to 3 and a reminder for step 5
scripts/setup-github.sh ruleset    # step 4, then a read-back check
```

The same steps with raw `gh` commands:

1. **Environment and model secret.** Create the Environment `test-agent`, limit its deployment branches to `main`, and set the model secret in it: either `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`. Keep no repo-level model secret: `pr-intake` runs from PRs ([ADR 0004](docs/adr/0004-isolate-pr-code-from-secrets.md)).

   ```sh
   gh api -X PUT repos/OWNER/REPO/environments/test-agent \
     -F deployment_branch_policy[protected_branches]=false -F deployment_branch_policy[custom_branch_policies]=true
   gh api -X POST repos/OWNER/REPO/environments/test-agent/deployment-branch-policies -f name=main -f type=branch
   gh secret set ANTHROPIC_API_KEY --env test-agent
   gh secret delete ANTHROPIC_API_KEY    # the repo-level copy, once the workflow works
   ```

2. **Five repo variables.** Budgets, with no defaults. A run fails in `scope` if one is missing or invalid. See [ADR 0006](docs/adr/0006-set-budgets-as-admin-only-repo-variables.md).

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

4. **Merge gate.** The ruleset is in `.github/rulesets/main.json`. Its only bypass actor is the admin role, through a PR; when that may be used is in [ADR 0005](docs/adr/0005-gate-merges-on-test-agent-verify.md). Apply it after the workflow is merged to `main`. Before that, a PR whose branch lacks the workflow waits for a status that nothing posts.

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
- **Agent skills.** `.claude/skills/`, one folder per skill, preloaded through each agent's `skills:` list: `scope-change`, `extract-intent`, `author-tests`, `prove-tests` and `review-tests`. `map-coverage-gaps` is Backfill only: the Backfill prompt tells the Author to read it. The package playbooks are `author-tests/backend.md` and `author-tests/frontend.md`.
- **Contributor skills.** Also in `.claude/skills/`, for a person's or a coding agent's own Claude Code session: `ship-change` (branch, checks, review, commit, cleanup), `github-ops` (issues, PRs, comments, statuses and re-runs through `gh`), `prove-script-test` (break each defence a script test covers and see it fail), `run-local-workflow` (runs the local make commands, asking for the intent first) and `report-backfill` (the Backfill PR description and Defects comment). The Author and Reviewer cannot load them: neither has the `Skill` tool, so each sees only the skills its agent file lists.
- **Settings.** `.claude/agent-settings.json` holds the tool allow and deny lists and the guard hook, which blocks writes outside the test paths and shell commands outside `AGENT_COMMANDS` in `rules.ts`. Every agent run receives it; see [ADR 0001](docs/adr/0001-use-claude-code-action-as-agent-runtime.md).
- **Rules, schemas and scripts.** `.github/scripts/`. These run without a model and are the source for the rules, the output schemas and the status decision.

  | Folder | Holds | Files |
  |---|---|---|
  | `contracts/` | Rules and output formats, no logic | `rules.ts`, `author.schema.json`, `reviewer.schema.json`, `gaps.schema.json`, `backfill-decisions.schema.json` |
  | `agent/` | Security controls that run inside or around an agent session | `sandbox.sh`, `guard.ts` |
  | `workflow/` | The CI jobs' steps | `intake.ts`, `prepare.ts`, `agent-output.ts`, `verify.sh`, `results.ts`, `context.ts`, `report.ts`, `render.ts`, `status.ts`, `sanitize.ts`, `github.ts` |
  | `local/` | Local runs only, from the Makefile and contributor skills | `trial.ts` |
  | `lib/` | Shared helpers, no CLI | `artifacts.ts`, `cli.ts`, `json.ts`, `schema.ts`, `scan.ts` |
  | `tests/` | Tests of the scripts above | `run.ts`, `*.test.ts` |

- **Workflows.** `.github/workflows/pr-intake.yml` (one job, no secrets) and `.github/workflows/pr-test-engineer.yml`. The second wires the jobs below. [docs/pr-run.md](docs/pr-run.md) follows one PR run step by step: which job writes the tests, which pushes them, and what keeps a bad patch out.

| Job | Runs a model | Write access | Runs PR code | What it does |
|---|---|---|---|---|
| `intake` | no | none (read-only token) | no | Downloads the `intake` artifact of the `pr-intake` run and checks it against the live PR (`intake.ts`). Stops with no status and no comment for a closed PR, a fork, or a head that moved. |
| `scope` | no | commit status | no | Reads the live PR. Checks the budget variables. Writes `scope.json`. Sets the status to pending. |
| `agents` | yes: Author, then Reviewer (secret from the Environment `test-agent`) | none (read-only token) | only in containers | Restores base-branch config, and checks it again before each agent. Installs dependencies in the sandbox. Runs the agents. Saves `author.json`, `reviewer.json` and `tests.patch`. |
| `bot_commit` | no | repo contents | no | Checks the patch and the agent output. Drops test files with blocking Findings, and new files that hold a flagged Defect's test; those Defect test files go to the artifact `defects`. Pushes the Bot commit. |
| `suites` | no | none (read-only token) | yes, on the host, with no secrets | Typecheck and suites with coverage on the final commit, and the tests of the workflow's own scripts. The job fails when one fails. Runs the `defects` test files once, on a copy of the final tree with no network where the runner allows it, for information only: the job result does not depend on it. Mutation testing for information only. Uploads the raw reports; no trusted step runs after PR code. |
| `publish` | no | commit status, PR comments | no | Downloads each artifact only if its job succeeded. Turns the raw reports into `results.json`, and the Defect test run into `proof.json` (`defect-proof.ts`). Decides the status. Renders the three comments and the job summary. |

Agents never post. Only `scope` (the pending status) and `publish` (the final status and the comments) post to the PR. `bot_commit` pushes the Bot commit.

The PR checks list shows each job by its `name:`, such as "Suites: typecheck, coverage, mutation". The status the run ends in is still `test-agent/verify`: the ruleset requires that name.

In the `suites` log, `head` is the analyzed PR head and `final` is the Bot commit, or the head when there is none. The first step names both commits. Each package's install, typecheck, tests and mutation sit in a folded group named `<package> · <head|final> · <what>`, and each step ends with one summary line per package.

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

Between the pushes, the author ran `git pull --rebase` to take the Bot commit, then changed `<=` to `<`. In push 2 the Author added the due-today test the first run could not commit, and marked the other Units as covered by the tests from push 1. Each run updated the same three comments in place. Each Bot commit left a workflow run waiting for approval, which does nothing.

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

These four decisions, and the gaps both Backfills found unreachable or not worth testing, are recorded in `docs/backfill-decisions.json`. Later gap lists leave them out until their file changes ([ADR 0008](docs/adr/0008-run-the-backfill-locally-and-report-it-in-the-pr-description.md)).

## Assumptions and limitations

### Assumptions

- One maintainer, who is a repo admin. No review approvals are required.
- The repo is on GitHub with Actions enabled and a hosted Ubuntu runner, which has Docker.
- The model key is a secret of the Environment `test-agent`, and the spend limit is set in the console.
- The Intent sources are correct. The workflow cannot check them.
- The agents and skills are specific to Claude Code: they live in `.claude/`, because the owner works in Claude Code. A tool-neutral location such as `.agents/skills/` would let other agent CLIs use them too. Moving them would also mean adding that folder to the base-branch overlay and to the sandbox's read-only paths ([ADR 0004](docs/adr/0004-isolate-pr-code-from-secrets.md)), so a PR cannot change the skills its own run uses.

### Limitations

**Trust boundary**

- Same-repo PR code is trusted more than fork code. `suites` runs the PR's own test setup (`npm ci`, configs, tests) on the host, without secrets. The sandbox mounts the checkout read-only, and the overlay is checked again before each agent; one writable path remains, `backend/src/generated`, which that check covers for instruction files. The controls are a person reading the diff and the limits in [ADR 0004](docs/adr/0004-isolate-pr-code-from-secrets.md). CODEOWNERS would add a required review, which a sole maintainer cannot give.
- A same-repo author can forge a green `test-agent/verify`. Every status comes from the GitHub Actions app, and a PR can edit `pr-intake` to ask for `statuses: write` and post one. A same-repo author already has write access, so this is accepted for now. Closing it needs a GitHub App as the status source (see the production version).
- `suites` runs PR code on the host, so that code can forge the raw reports (coverage, Stryker report, test counts) it uploads as the artifact `reports`. Green needs the `suites` job result, which fails when a typecheck or suite fails; `results.ts` runs in `publish`, keeps only numbers and known labels, and its output can only add red reasons. A forged coverage or mutation figure can still reach the report; the PR author can already write passing tests. `publish` downloads `scope`, `agents` and `checked` only when their job succeeded, so `suites` cannot replace them (artifact names are unique and immutable). B uses no cache.
- The proof of a Defect comes from a report that PR code wrote, so the PR can forge it. Forging "proven" turns its own status red. Forging "unproven" makes a confirmed Defect a warning, which weakens the gate. A same-repo author can already edit the code under test and the suites, so this is accepted; the Defect stays visible in the Report as unproven, with its reason. If the Defect test run does not happen (no report, the patch does not apply, the step fails), the Defect is also unproven. The run has no network where the runner has `unshare` and passwordless `sudo`; otherwise the log says it ran with network.
- Fork PRs get no agent run and no status. A maintainer pushes the branch into the repo to merge it.
- The owner is the only admin, so they can merge past the gate with the bypass. Every bypass shows on the PR and in the audit log, and [ADR 0005](docs/adr/0005-gate-merges-on-test-agent-verify.md) limits when it is used.

**Agent results**

- The Reviewer is a model too. It lowers the rate of false Defects; it does not remove them.
- A blocking Finding drops its whole test file from the Bot commit, good tests included ([ADR 0003](docs/adr/0003-derive-expectations-from-intent-and-review-defects.md)).
- The agents do not always follow procedure. In demo runs the Author used shell commands for file work and tried commands its rules deny; the guard hook now blocks every shell command outside `AGENT_COMMANDS` and names the tool to use instead. One summary named a Unit that does not exist while the Units table was right. `agent-output.ts` now rejects a Unit whose name is not in its file and a test whose file does not exist, and flags in the comment each backticked name in a summary that no Unit, test or file of the run contains. A flagged name does not change the status, and a drifted name in plain text is not caught: read the tables, not only the summary. Rendering summaries from the structured output is planned.

**Workflow**

- Each push costs two agent runs. Local demo runs on a one-function change cost about $0.30 together; larger changes cost more. Each agent step is capped by `TEST_AGENT_MAX_TURNS` and `TEST_AGENT_TIMEOUT_MINUTES`. With `CLAUDE_CODE_OAUTH_TOKEN`, runs share the subscriber's usage limits.
- The final status waits for mutation testing, up to 8 minutes per package. The mutation score is reported, not enforced.
- Each Bot commit leaves a `pr-intake` run waiting for approval, because GitHub holds runs started by a `GITHUB_TOKEN` push. The run does nothing, and `pr-test-engineer` does not start.
- The agents start about a minute after a push, because `pr-intake` runs first and `pr-test-engineer` starts when it ends. The pending status appears after `scope`, so until then the merge is blocked as "expected".
- A PR that changes the agent config runs with the base copy, so CI cannot test the change. `make demo` tests it locally against two committed cases, a planted Defect and a tautology the Reviewer must block ([ADR 0009](docs/adr/0009-test-agent-config-changes-against-committed-cases.md)); nothing requires that it ran.

**Backfill**

- No CI run proves a Backfill's results. Its PR description is written from the tables `make backfill-tests` renders, so the prose around them can drift ([ADR 0008](docs/adr/0008-run-the-backfill-locally-and-report-it-in-the-pr-description.md)).
- A decided gap is left out of later gap lists only while its file is unchanged and the records cover all of the gap's uncovered lines, which the Author lists for each gap. Otherwise the owner decides it again ([ADR 0008](docs/adr/0008-run-the-backfill-locally-and-report-it-in-the-pr-description.md)).

**Scripts**

- The script tests cover the scripts that decide what reaches the PR (`guard.ts`, `sanitize.ts`, `agent-output.ts`, `status.ts`, `intake.ts`), the comment renderers in `render.ts`, the job-result reading of `context.ts`, and the local `trial.ts`. The scripts that call GitHub (`prepare.ts`, `report.ts`, `github.ts`) and the shell scripts have no tests.
- The TypeScript types in `artifacts.ts` repeat the schema enums by hand, so they can drift from the schemas.

**App**

- The overdue badge and the overdue counter can disagree around midnight. `due_date` is a calendar date with no time or offset, so the badge compares it with the user's local date and the counter with the UTC date. Left as is on purpose: the fix changes the data model, outside this task.

### Not verified on the live repo yet

- The `skip-test-agent` label from a user without maintain rights, which must be ignored. This needs a second GitHub account. The admin half is proven: run 40949797997 shows "skipped by label", with the `suites` job still run.
- A tautological test dropped from a real Bot commit. The same chain is proven locally: the `tautology` case of `make demo` gets a blocking `tautology` Finding from the Reviewer, and `agent-output.ts` drops exactly that test file ([ADR 0009](docs/adr/0009-test-agent-config-changes-against-committed-cases.md)).

## Production version

Items a production version would add.

**Security**

- Container isolation for every job that runs PR code, `suites` included, with no host fallback. This also closes the forged results above.
- The status posted by a GitHub App, whose integration id the ruleset pins, in place of the GitHub Actions app. This closes the forged green status.
- CODEOWNERS on `.github/`, `.claude/` and the test run config (`**/package.json`, the vitest and vite configs, test setup files), with a ruleset that requires code-owner review. This needs a team, and a release-manager team as the only bypass actor.
- Budgets and config read from the base branch only.
- A fork PR flow, where a maintainer applies a label to start a run.

**Reliability**

- One bounded revise round after review: the Author fixes the flagged tests, a narrow final review runs, and only then are blocked tests dropped. This replaces dropping whole files.
- Agent procedure moved into scripts: summaries rendered from the structured output.
- Citation checks on the Intent sources in the tests.
- The mutation score as a gate on changed files.
- A check for gaps in the lines a PR touches, reported as a separate required check.
- Tests for the scripts that call GitHub, against a fake API.
- The committed agent-test cases (`truncate`, `tautology`) run in a scheduled CI job, with more cases added over time.
- The whole Backfill PR description rendered by a script.

**Usability and cost**

- An interactive setup wizard with guided steps, links to the console pages, and a summary of skipped steps, in place of the plain setup script.
- Run modes and triggers, read from the base branch. For example, a strict mode with a local pre-push hook, and a manual trigger by label.
- Optional human approval before the Bot commit, through a GitHub Environment with required reviewers.
- Coverage and mutation in the local `make trial`, which today stops before `suites`.
- Cost telemetry for each run.

**App and checks outside this task**

- The due moment stored as a UTC instant (`timestamptz`), so the badge and the counter both check `now > due` and agree.
- API smoke tests against Postgres, and a frontend build, in `suites`.
