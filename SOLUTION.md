# Solution: PR test engineer

For reviewers: what this repo adds, how to run it, what to set up, and what is still open.

This repo adds two ways to get tests written, both by the same agents and skills:

- **PR workflow:** adds or updates tests for the Units a PR changes. GitHub Actions runs it on each PR that is ready for review.
- **Backfill:** adds tests for existing, untested code, in one pass. The owner runs it locally (`make backfill-gaps`, then `make backfill-tests`) and reports it in the PR description ([ADR 0008](docs/adr/0008-run-the-backfill-locally-and-report-it-in-the-pr-description.md)).

## Key decisions

| Decision | Why | ADR |
|---|---|---|
| Agents run in Claude Code through `claude-code-action` | Permissions, hooks and structured output come ready-made, and a local trial matches CI | [0001](docs/adr/0001-use-claude-code-action-as-agent-runtime.md) |
| Test changed Units only; write test files only | A run stays small, and an agent cannot make a test pass by editing the code | [0002](docs/adr/0002-test-changed-units-and-write-only-tests.md) |
| Expectations come from Intent sources; failing tests become Defects; a second agent reviews them | Tests built from the code's output agree with it, and one agent should not check its own reading | [0003](docs/adr/0003-derive-expectations-from-intent-and-review-defects.md) |
| PR code never runs next to the model key; agent config comes from the base branch | PR code is untrusted, and a PR could otherwise edit the workflow or the agents that judge it | [0004](docs/adr/0004-isolate-pr-code-from-secrets.md) |
| Merge gate on `test-agent/verify`, a `skip-test-agent` label, and an admin bypass | GitHub enforces it; the label skips the agents, never the suites; some PRs cannot pass their own run | [0005](docs/adr/0005-gate-merges-on-test-agent-verify.md) |
| Budgets are admin-only repo variables with no defaults; agents skip draft PRs | A PR must not raise its own budget, and a silent default is an unreviewed choice | [0006](docs/adr/0006-set-budgets-as-admin-only-repo-variables.md) |
| Defects appear as review comments on the changed code, with a suggested fix (proposed, not built) | A person makes every fix, and the code is where they already review | [0007](docs/adr/0007-report-defects-next-to-the-code-with-a-suggested-fix.md) |
| The Backfill runs locally and reports in its PR description | It stops for the owner's approval, and its PR has no source lines to test | [0008](docs/adr/0008-run-the-backfill-locally-and-report-it-in-the-pr-description.md) |
| A change to the agent config is tested with `make demo` against committed cases | The PR's own run uses the base config, so CI cannot test the change | [0009](docs/adr/0009-test-agent-config-changes-against-committed-cases.md) |
| A slip in one Unit's output makes that Unit not verified, not the whole run invalid | The slips are labels, not invalid tests; one must not cost the other Units or hide a confirmed Defect | [0010](docs/adr/0010-reject-one-unit-not-the-run-for-its-own-slip.md) |
| A configurable ignore list: the owner excludes source paths from agent testing and coverage, each with a reason, read from `main` only | Every repo has code it chooses not to unit-test; the choice and its reason belong in one reviewed place, and a PR must not ignore its own code | [0011](docs/adr/0011-let-the-owner-ignore-source-paths-with-a-reason.md) |

## How to run the PR workflow

- **Automatic.** `pr-intake` runs from the PR when it is opened, reopened, marked ready for review, pushed to, or when the `skip-test-agent` label changes. When it succeeds, `pr-test-engineer` runs from the default branch. Fork PRs start neither. A draft PR gets the suites but no agent run ([ADR 0006](docs/adr/0006-set-budgets-as-admin-only-repo-variables.md)).
- **Re-run on the current head.** Use it after a failed or cancelled run, or after a budget variable changes. It is accepted only from `main`, and it stops on a fork PR.

  ```sh
  gh workflow run pr-test-engineer.yml -f pull-request=<n>
  ```

- **Locally.** `make trial` runs the steps on your branch; `make demo` runs them on committed cases (run it before a PR that changes the agent config). More in [AGENTS.md](AGENTS.md).
- **Concurrency.** A newer push cancels the older run for the same PR. Events that start no real run use their own group, so they cannot cancel one.
- **Where to look.** The PR checks list shows only `pr-intake` and the status `test-agent/verify`. The jobs of `pr-test-engineer` run from the default branch through `workflow_run`, so GitHub attaches them to `main`, not to the PR. The Details link of the status opens the run; `gh run list --workflow pr-test-engineer.yml` lists runs. The status name is fixed because the ruleset requires it.

The run ends in the status and three PR comments, updated in place; the Report keeps a "Previous runs" section (`history.ts`). How to read them and act on a Defect: [docs/pr-results.md](docs/pr-results.md).

## Prerequisites

`scripts/setup-github.sh` does the setup. It needs `gh` and `jq`, logged in as a repo admin.

```sh
scripts/setup-github.sh config     # steps 1 to 3 and 6, and a reminder for step 5
scripts/setup-github.sh ruleset    # step 4 (after step 6 and the merge), then a read-back check
```

1. **Environment and model secret.** The Environment `test-agent`, with deployment branches limited to `main`, holds the model secret: `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`. Keep no repo-level model secret ([ADR 0004](docs/adr/0004-isolate-pr-code-from-secrets.md)).
2. **Five repo variables, with no defaults:** `TEST_AGENT_MODEL`, `TEST_AGENT_REVIEWER_MODEL`, `TEST_AGENT_MAX_TURNS`, `TEST_AGENT_TIMEOUT_MINUTES`, `TEST_AGENT_MAX_ATTEMPTS`. A run fails in `scope` if one is missing or invalid ([ADR 0006](docs/adr/0006-set-budgets-as-admin-only-repo-variables.md)). An optional `TEST_AGENT_SKIP_ACTORS` is a fallback for the skip label ([ADR 0005](docs/adr/0005-gate-merges-on-test-agent-verify.md)).
3. **Skip label.** `skip-test-agent`.
4. **Merge gate.** The ruleset `.github/rulesets/main.json`; its only bypass actor is the admin role, through a PR. It requires `test-agent/verify` from the GitHub App of step 6: the file's `integration_id` is a placeholder that the script fills from `TEST_AGENT_APP_ID`. Apply it after the workflow is merged to `main`, or PRs wait for a status nothing posts.
5. **Monthly spend limit,** in the model provider's console (`https://console.anthropic.com/settings/limits`). It is the hard cap on money.
6. **GitHub App.** `config` prints a prefilled creation link (contents, commit statuses and pull requests: read and write). Generate a private key and install the App on this repo only. `config` then verifies the installation and sets the Environment secret `TEST_AGENT_APP_PRIVATE_KEY`, the Environment variables `TEST_AGENT_APP_ID` and `TEST_AGENT_APP_CLIENT_ID`, and the repo variable `TEST_AGENT_BOT_LOGIN`. `scope`, `bot_commit` and `publish` write with the App's short-lived token ([ADR 0004](docs/adr/0004-isolate-pr-code-from-secrets.md)).

**Optional: ignored paths.** [`ignored-paths.json`](.github/scripts/contracts/ignored-paths.json) lists source the agents do not test and coverage leaves out: per package, path globs and a reason. The Report shows the reason next to each skipped file. Change it with a PR to `main`; PR runs read `main`'s copy, so a PR cannot ignore its own code. An entry without a reason stops the run. The repo ships one entry, the design system ([ADR 0011](docs/adr/0011-let-the-owner-ignore-source-paths-with-a-reason.md)).

## Agents, skills and the workflow

- **Agents.** `.claude/agents/pr-test-engineer.md` (the Author) and `.claude/agents/pr-test-reviewer.md` (the Reviewer).
- **Agent skills.** `.claude/skills/`, preloaded through each agent's `skills:` list: `scope-change`, `extract-intent`, `author-tests` (with the playbooks `backend.md` and `frontend.md`), `prove-tests` and `review-tests`. `map-coverage-gaps` is Backfill only: the Backfill prompt tells the Author to read it.
- **Contributor skills.** Also in `.claude/skills/`, for a person's own session: `ship-change`, `github-ops`, `prove-script-test`, `run-local-workflow`, `report-backfill`. The agents cannot load them: neither has the `Skill` tool.
- **Settings.** `.claude/agent-settings.json` holds the tool allow and deny lists and the guard hook, which blocks writes outside the test paths and shell commands outside `AGENT_COMMANDS` in `rules.ts` ([ADR 0001](docs/adr/0001-use-claude-code-action-as-agent-runtime.md)).
- **Scripts.** `.github/scripts/` runs without a model: `contracts/` (rules, schemas, and `ignored-paths.json` for source the owner chose not to test), `agent/` (sandbox, overlay, guard), `workflow/` (the CI steps, among them `defect-proof.ts` and `flaky.ts`), `local/`, `lib/` and `tests/`.
- **Workflows.** `pr-intake.yml` (one job, no secrets) and `pr-test-engineer.yml`, whose jobs run in this order; [docs/pr-run.md](docs/pr-run.md) has the job table and follows one run step by step.
  - `intake` checks the `pr-intake` artifact against the live PR and stops quietly on a closed PR, a fork or a moved head.
  - `scope` checks the budget variables, writes `scope.json`, sets the status to pending.
  - `agents` restores the base-branch config and runs the Author, then the Reviewer. It alone holds the model secret, and PR code runs in it only in containers.
  - `bot_commit` checks the patch and the output, drops test files with blocking Findings or a test that overclaims intent, and the files that hold a flagged Defect's test (kept in the artifact `defects`), and pushes the Bot commit. A Unit whose own output breaks a naming rule keeps its tests but counts as not verified ([ADR 0010](docs/adr/0010-reject-one-unit-not-the-run-for-its-own-slip.md)).
  - `suites` runs PR code on the host with no secrets: typecheck, suites with coverage, the scripts' own tests, three shuffled reruns of the Bot commit's test files (flaky check), mutation testing (information only), and the `defects` test files once.
  - `publish` turns the reports into `results.json` (with the changed lines the suite ran, from scope hunks and lcov, as numbers only) and `proof.json`, decides the status, renders the comments.
- **Who posts.** Agents never do. Only `scope` (pending) and `publish` (final status, comments) post, and only `bot_commit` pushes.
- **Defects and the status.** A confirmed Defect turns the status red when it is proven (its test failed in `suites`) or its test is missing. One that is unproven although its test is present is a warning, shown with its reason ([ADR 0005](docs/adr/0005-gate-merges-on-test-agent-verify.md)).
- **CI on `main`.** `.github/workflows/ci.yml` runs the script tests and each package's typecheck and tests with coverage after a merge. It has no secrets and no `pull_request` trigger.

## Example run

Demo PR [#70](https://github.com/nikitaromanchukdev/taskly-app-node/pull/70) adds `GET /api/todos/due-soon?days=N`. Its description states the intended behaviour, including that a todo due exactly N days from today is included. The first push plants a Defect: that todo is left out. The second push fixes it. Both runs used the same skills: the Author ran `scope-change`, `extract-intent`, `author-tests` and `prove-tests`; the Reviewer ran `review-tests`.

| | Push 1: planted Defect | Push 2: fix |
|---|---|---|
| Run | [41069426284](https://github.com/nikitaromanchukdev/taskly-app-node/actions/runs/41069426284) | [41070660047](https://github.com/nikitaromanchukdev/taskly-app-node/actions/runs/41070660047) |
| Analyzed → Bot commit | `5b1b949` → `04f8a09`: route tests (the Defect test is kept out and run on its own) | `d237401` → `168d4c7`: three boundary tests for `isDueSoon` |
| Units and tests | 5 Units: 1 amended, 1 flagged Defect (`isDueSoon`), 3 not needed (already covered) | 5 Units: `isDueSoon` amended, 4 not needed; 1 advisory Finding |
| Defect | One, confirmed by the Reviewer with a quote of the PR description, and proven by its failing test in `suites` | none |
| Coverage | The Defect test failed in `suites` with `expected` and `received` matching the Author's values | Every changed line covered (`dueSoon.ts` 10/10, `router.ts` 4/4); mutation score 91% |
| `test-agent/verify` | 🔴 1 proven defect: merge blocked | 🟢 |

Between the pushes the author took the Bot commit with `git pull --rebase` and fixed the comparison. After push 2 the Report's "Previous runs" section still lists the red run. Earlier runs on the same PR are listed there too: they found three bugs in the workflow's own checks, fixed before the run above ([ADR 0010](docs/adr/0010-reject-one-unit-not-the-run-for-its-own-slip.md)).

## Backfill run

The Backfill ran once per package ([ADR 0008](docs/adr/0008-run-the-backfill-locally-and-report-it-in-the-pr-description.md)); each PR description holds the full results.

| | Backend [#24](https://github.com/nikitaromanchukdev/taskly-app-node/pull/24) | Frontend [#25](https://github.com/nikitaromanchukdev/taskly-app-node/pull/25) |
|---|---|---|
| Lines, before → after | 40.16% → 86.06% | 61.25% → 99.37% |
| Mutation (local Stryker) | 68.71% | 94.57% |
| Defects | none confirmed; 2 Suspected | none confirmed; 2 Suspected |

The owner kept the behaviour of all four Suspected Defects. They and the gaps found unreachable are in `docs/backfill-decisions.json`; later gap lists leave them out until their file changes.

## Assumptions and limitations

### Assumptions

- One maintainer, who is a repo admin. No review approvals are required.
- GitHub with Actions and a hosted Ubuntu runner (which has Docker); the model key and spend limit are set up as in the prerequisites.
- The Intent sources are correct. The workflow cannot check them.
- The agents and skills are specific to Claude Code and live in `.claude/`. A tool-neutral folder such as `.agents/skills/` would need to join the base-branch overlay and the sandbox's read-only paths ([ADR 0004](docs/adr/0004-isolate-pr-code-from-secrets.md)).

### Limitations

**Trust boundary**

- Same-repo PR code is trusted more than fork code. `suites` runs the PR's own test setup (`npm ci`, configs, tests) on the host, without secrets. The sandbox mounts the checkout read-only except `backend/src/generated`, and the overlay is checked before each agent. The controls are a person reading the diff and the limits in [ADR 0004](docs/adr/0004-isolate-pr-code-from-secrets.md).
- The ruleset accepts `test-agent/verify` only from the GitHub App, so a status a PR's own workflow posts does not count. Proven live on PR #77: its workflow posted a forged success after the App's failure; GitHub's combined status turned green, and the merge stayed `BLOCKED`. What the gate trusts: the workflow on `main`, the App's private key (in the Environment, reachable only from `main`), and the admin bypass.
- PR code in `suites` can forge the raw reports it uploads (coverage, Stryker, test counts). Green needs the `suites` job result, and `results.ts` (in `publish`) keeps only numbers and known labels and can only add red reasons. A forged coverage or mutation figure can still reach the report.
- A Defect's proof comes from a report that PR code wrote. Forging "proven" turns its own status red; forging "unproven" turns a confirmed Defect into a warning, which weakens the gate. This is accepted for the same reason; the Report shows the Defect as unproven, with its reason. The Defect test run has no network where the runner has `unshare` and passwordless `sudo`; otherwise the log says so.
- Fork PRs get no agent run and no status; a maintainer pushes the branch into the repo to merge it.
- The owner is the only admin and can merge past the gate. Every bypass shows on the PR and in the audit log ([ADR 0005](docs/adr/0005-gate-merges-on-test-agent-verify.md)).

**Agent results**

- The Reviewer is a model too: it lowers the rate of false Defects, not to zero. A blocking Finding drops its whole test file, good tests included ([ADR 0003](docs/adr/0003-derive-expectations-from-intent-and-review-defects.md)).
- The agents do not always follow procedure; the guard hook and `agent-output.ts` catch what they can. A summary can still drift in plain text, so read the tables, not only the summary.

**Workflow**

- Each push costs two agent runs: about $0.30 together for a one-function change in local demo runs, more for larger changes. `TEST_AGENT_MAX_TURNS` and `TEST_AGENT_TIMEOUT_MINUTES` cap each step. With `CLAUDE_CODE_OAUTH_TOKEN`, runs share the subscriber's usage limits.
- A run tests at most `MAX_CANDIDATES` changed source files ([`rules.ts`](.github/scripts/contracts/rules.ts)); the rest are skipped as `over-cap` ([ADR 0002](docs/adr/0002-test-changed-units-and-write-only-tests.md)). The Author is one session: if it hits the turn limit it returns no structured output, and the status is red with no tests.
- The final status waits for mutation testing (up to 8 minutes per package); the score is reported, not enforced.
- The App pushes the Bot commit, which starts a `pr-intake` run that does nothing (the Bot actor is skipped). Whether GitHub still asks to approve that run is not verified yet; approving it changes nothing.
- The agents start about a minute after a push; until `scope` sets the pending status, the merge is blocked as "expected".
- A PR that changes the agent config runs with the base copy. `make demo` tests it locally; nothing requires that it ran ([ADR 0009](docs/adr/0009-test-agent-config-changes-against-committed-cases.md)).

**Backfill and scripts**

- No CI run proves a Backfill's results; its PR description is written from rendered tables, so the prose around them can drift.
- A decided gap stays out of later gap lists only while its file is unchanged and the records cover all its uncovered lines (`gap-lines.ts`) ([ADR 0008](docs/adr/0008-run-the-backfill-locally-and-report-it-in-the-pr-description.md)).
- The script tests cover the scripts that decide what reaches the PR, the renderers, the run history and the local scripts. `prepare.ts` is tested only for the candidate cap. The GitHub calls, `report.ts`, `github.ts` and the shell scripts have no tests.
- Types in `artifacts.ts` repeat the schema enums by hand and can drift.

**App**

- The overdue badge and the overdue counter can disagree around midnight. `due_date` is a calendar date with no time or offset, so the badge compares it with the user's local date and the counter with the UTC date. Left as is on purpose: the fix changes the data model, outside this task.

### Not verified on the live repo yet

- The `skip-test-agent` label from a user without maintain rights, which must be ignored. This needs a second GitHub account. The admin half is proven: run 40949797997 shows "skipped by label", with the `suites` job still run.
- A tautological test dropped from a real Bot commit. The same chain is proven locally: the `tautology` case of `make demo` gets a blocking `tautology` Finding from the Reviewer, and `agent-output.ts` drops exactly that test file ([ADR 0009](docs/adr/0009-test-agent-config-changes-against-committed-cases.md)).

## Production version

- **Security.** Container isolation for every job that runs PR code, `suites` included (closes the forged results). CODEOWNERS on `.github/`, `.claude/` and the test run config, with code-owner review and a release-manager team as the only bypass actor. A fork PR flow, where a maintainer applies a label to start a run.
- **Reliability.** One Author session per package or batch of Units. One bounded revise round after review, instead of dropping whole files. Summaries and the Backfill PR description rendered by scripts; citation checks on Intent sources. The mutation score as a gate on changed files, and a required check for coverage gaps in the changed lines (the Report already shows them, for information). Tests for the scripts that call GitHub, against a fake API; the agent-test cases in a scheduled CI job.
- **Usability and cost.** An interactive setup wizard; run modes and triggers read from the base branch; optional human approval before the Bot commit, through an Environment with required reviewers; coverage and mutation in `make trial`; cost telemetry per run.
- **App, outside this task.** The due moment stored as a UTC instant (`timestamptz`), so the badge and the counter agree. API smoke tests against Postgres and a frontend build in `suites`.
