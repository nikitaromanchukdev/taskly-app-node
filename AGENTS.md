# Working in this repo

For contributors and coding agents who change the app, its tests, or the PR workflow.

The agents of the PR workflow and the Backfill follow their own agent files, which take precedence over this file. They never commit, push, post, or run npm on the host. The push, commit and command steps below are for people.

## Map

| Path | What |
|---|---|
| `backend/src/`, `frontend/src/` | The app. Test paths per package: `TEST_PATHS` in [`rules.ts`](.github/scripts/contracts/rules.ts) |
| `.github/workflows/pr-intake.yml` | Workflow A: runs from the PR, no secrets; uploads the intake artifact |
| `.github/workflows/pr-test-engineer.yml` | Workflow B: `workflow_run` after A, from `main`, with secrets. Jobs: `intake`, `scope`, `agents`, `bot_commit`, `suites`, `publish` |
| `.github/workflows/ci.yml` | Tests and typecheck on `main` after a merge |
| `.github/scripts/agent/` | `overlay.sh` (base-branch agent config), `sandbox.sh` (Docker), `guard.ts` (write guard hook and patch check) |
| `.github/scripts/workflow/` | The job scripts. `intake` → intake.ts · `scope` → prepare.ts · `agents` → `agent/overlay.sh`, `agent/sandbox.sh` · `bot_commit` → `agent/guard.ts patch`, agent-output.ts, defect-proof.ts · `suites` → verify.sh (runs flaky.ts) · `publish` → results.ts, defect-proof.ts, context.ts, report.ts (with status, render, history, sanitize) |
| `.github/scripts/contracts/` | `rules.ts` and the JSON schemas: the only home of the rules |
| `.github/scripts/lib/` | Shared helpers; `artifacts.ts` lists the files jobs pass to each other |
| `.github/scripts/local/` | `make trial` and Backfill helpers |
| `.github/scripts/tests/` | `<script>.test.ts` per script; `run.ts` runs a script as its own process |
| `.claude/agents/`, `.claude/skills/`, `.claude/agent-settings.json` | The Author and the Reviewer, their skills and settings, and the contributor skills below |
| `.github/agent-tests/` | The `make demo` cases |
| `.github/rulesets/`, `scripts/setup-github.sh` | Branch ruleset and one-time repo setup |
| `docs/adr/` | Decisions, see below. `docs/pr-run.md`: one run step by step. `docs/pr-results.md`: reading and acting on the PR comments |

Do not read: `node_modules/`, `coverage/`, `dist/`, `.test-agent/`, `backend/src/generated/`, lockfiles. `docs/backfill-decisions.json` is data; change it with the make targets.

## Where a change goes

| Change | Files | Check |
|---|---|---|
| App behaviour | `backend/src/` or `frontend/src/` and its tests | `npm test`, `npm run typecheck` in the package |
| PR comment text or layout | `workflow/render.ts`, `tests/render.test.ts` | `node --test .github/scripts/tests/render.test.ts` |
| Status policy | `workflow/status.ts` | `make script-tests` |
| Test paths, skip rules, agent commands | `contracts/rules.ts` | `make script-tests` |
| Sandbox, overlay or write guard | `agent/` | `make script-tests`, `make hook-demo` |
| Agent or skill prompt | `.claude/agents/`, `.claude/skills/` | `make demo` (uses model tokens) |

Paths in this table are under `.github/scripts/` unless they start with a package or `.claude/`. Script tests need Node 24 and no install.

## Before you explore

- **Decisions.** Read the ADRs for the area you change. If your change contradicts one, say which and why in the PR description, and update the ADR in the same PR. Never override an ADR silently.

  | ADR | Area |
  |---|---|
  | [0001](docs/adr/0001-use-claude-code-action-as-agent-runtime.md) | Agent runtime |
  | [0002](docs/adr/0002-test-changed-units-and-write-only-tests.md) | What the Author tests; it writes only tests |
  | [0003](docs/adr/0003-derive-expectations-from-intent-and-review-defects.md) | Expectations, Intent sources, Defect review |
  | [0004](docs/adr/0004-isolate-pr-code-from-secrets.md) | Secrets, the A/B workflow split, overlay, sandbox |
  | [0005](docs/adr/0005-gate-merges-on-test-agent-verify.md) | Merge gate, `skip-test-agent` label, admin merge |
  | [0006](docs/adr/0006-set-budgets-as-admin-only-repo-variables.md) | Budgets |
  | [0007](docs/adr/0007-report-defects-next-to-the-code-with-a-suggested-fix.md) | Review comments on the code (proposed, not built) |
  | [0008](docs/adr/0008-run-the-backfill-locally-and-report-it-in-the-pr-description.md) | Backfill |
  | [0009](docs/adr/0009-test-agent-config-changes-against-committed-cases.md) | `make demo` for agent config changes |
  | [0010](docs/adr/0010-reject-one-unit-not-the-run-for-its-own-slip.md) | which `agent-output.ts` errors reject one Unit and which the whole run |

- **Terms.** Before you write docs, comments, prompts or any text people read, read [TERMINOLOGY.md](TERMINOLOGY.md) and use its terms as written, not the synonyms it lists. If a concept has no term there, say so instead of inventing one.
- **Rules live in code.** Test paths and skip rules are in [`rules.ts`](.github/scripts/contracts/rules.ts); Verdicts, reasons and kinds in [`author.schema.json`](.github/scripts/contracts/author.schema.json) and [`reviewer.schema.json`](.github/scripts/contracts/reviewer.schema.json); the status policy in [`status.ts`](.github/scripts/workflow/status.ts). Link them; never copy their lists into a doc.
- **One home per fact.** Why: an ADR. How to run and what was built: [SOLUTION.md](SOLUTION.md). How to work: this file. Acting on a PR run: [docs/pr-results.md](docs/pr-results.md). Terms: TERMINOLOGY.md. Change a fact in its home and link to it from elsewhere.

## Gotchas

- A PR's own run uses `main`'s agent config and scripts ([ADR 0004](docs/adr/0004-isolate-pr-code-from-secrets.md)). A change to `.claude/` or `.github/scripts/` has no effect on that PR's run; `make demo` and `make script-tests` are its only tests ([ADR 0009](docs/adr/0009-test-agent-config-changes-against-committed-cases.md)).
- Script tests run each script as its own process with only `PATH` set; pass any other variable through `runScript`'s `env`.

## What happens when you push to a PR

- Two workflows run on each push. `pr-intake` runs from your PR and records the event. When it ends, `pr-test-engineer` runs from `main`, so the agents start about a minute after the push. A PR cannot change `pr-test-engineer`, so a PR that edits it is not tested by its own run. Their jobs and triggers are in [SOLUTION.md](SOLUTION.md); one run step by step is in [docs/pr-run.md](docs/pr-run.md).
- On a draft PR the agents do not run; only the suites do. Open the PR as a draft while you iterate, and mark it ready for review when the change is done.
- It may add one Bot commit with tests to your branch. Run `git pull --rebase` before your next push, or your push will be rejected.
- GitHub then asks to approve a workflow run for the Bot commit. Approving it or not changes nothing: that run is `pr-intake`, and it does nothing.
- It sets the status `test-agent/verify` and writes three PR comments. Review comments on the changed code, with a suggested fix for each Defect, are proposed in [ADR 0007](docs/adr/0007-report-defects-next-to-the-code-with-a-suggested-fix.md) and not built yet. How to read the comments, what to do about a Defect, re-runs, the `skip-test-agent` label and merging without the gate: [docs/pr-results.md](docs/pr-results.md).

## Conventions

- **Commits.** Use Conventional Commits with a scope, for example `fix(backend): ...`.
- **Branches.** `feat/issue-<n>-<slug>`.
- **PR description.** Write the intended behaviour in it, and end with `Closes #<n>`. The test workflow reads the description as an Intent source.
- **Script code.** Branch with `switch` or lookup tables, not `if` chains. Declare named union types first and use them; do not derive them with `(typeof X)[number]`, `T['field']` or `ReturnType`.
- **Tests.** Package playbooks for the Author are in `.claude/skills/author-tests/`.

## Skills for contributors

Claude Code sessions in this repo can load these skills from `.claude/skills/`. The PR workflow's agents cannot; they load only their own.

| Task | Skill |
|---|---|
| Branch, run the checks, get a review, commit, push, clean up after the merge | `ship-change` |
| Open or edit a PR, comment, close an issue, read the bot comments, re-run the workflow | `github-ops` |
| Prove a new test in `.github/scripts/tests/` catches what it claims | `prove-script-test` |
| Run `make trial`, `make demo`, the Backfill, `make hook-demo` or `make clean` for you, with the intent or approval question and a summary | `run-local-workflow` |
| Write a Backfill PR description and its Defects comment | `report-backfill` |

## Commands

Setup is in [README.md](README.md). Run these from the package folder, `backend/` or `frontend/`. All scripts are in each package's `package.json`.

| Command | Backend | Frontend |
|---|---|---|
| Tests | `npm test` | `npm test` |
| Tests with coverage | `npm run test:coverage` | `npm run test:coverage` |
| Typecheck | `npm run typecheck` | `npm run typecheck` |

The workflow's own scripts: `make script-tests` from the repo root runs all their tests, `node --test .github/scripts/tests/<name>.test.ts` runs one. `suites` runs them on every PR; `ci.yml` runs the package checks on `main`.

## Local runs of the PR workflow

- `make trial` runs the PR workflow's steps locally against `main`. Set `BASE=<branch>` to compare with another branch. Commit your change first: the trial tests `git diff main...HEAD`.
- The first run on a branch asks where the intended behaviour comes from: the open PR's description, the branch's commit messages, typed in, your editor, or none. Without intent, Defects can only come from `openapi.json`, existing tests or docs. The answer is saved and reused for that branch. Delete `.test-agent/<branch>/pr-body.md` to be asked again.
- `make demo` checks the agent config on disk, committed or not, against the cases in [`.github/agent-tests/`](.github/agent-tests/): a planted Defect the agents must flag and confirm, and a tautological test the Reviewer must block. It prints `demo: PASS` or `demo: FAIL` per case; `make demo CASE=<name>` runs one. Run it before you open a PR that changes `.claude/` or `.github/scripts/`.
- **Backfill**, one package at a time: `make backfill-gaps PACKAGE=<backend|frontend>` has the Author rank the coverage gaps and asks which to approve; `make backfill-approve PACKAGE=… APPROVE=1,3` picks or changes them without a new agent run, and `DECLINE=2 REASON="…"` declines others; `make backfill-tests PACKAGE=…` tests the approved items, reviews the tests, and measures coverage before and after; once the PR is open, `make backfill-record PACKAGE=… PR=<n>` adds the declined items and not-needed Units to `docs/backfill-decisions.json`, for that PR. Later gap lists leave out each recorded gap, by its lines, until its source file changes. `backfill-tests` needs a clean working tree, so commit your changes first. See [ADR 0008](docs/adr/0008-run-the-backfill-locally-and-report-it-in-the-pr-description.md).
- `make hook-demo` asks an agent to edit `backend/src`, and checks that the write guard blocks it.
- Output goes to `.test-agent/<branch>/`, which git ignores. Nothing is pushed or posted. `make clean` removes the current branch's output and keeps its PR description and its approved and declined gaps; if the branch has none, it lists the other folders to pick from.
- Needs Node 24, `make`, `jq`, `rsync`, Docker running, and a logged-in Claude Code CLI. `make trial` and `make demo` use model tokens.

The steps are in the [Makefile](Makefile).
