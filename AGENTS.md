# Working in this repo

For contributors and coding agents who change the app, its tests, or the PR test workflow.

The agents of the PR test workflow follow their own agent files, which take precedence over this file. They never commit, push, post, or run npm on the host. The push, commit and command steps below are for people.

## What happens when you push to a PR

- The PR test workflow runs on each push. Its jobs and triggers are in [SOLUTION.md](SOLUTION.md).
- It may add one Bot commit with tests to your branch. Run `git pull --rebase` before your next push, or your push will be rejected.
- It sets the status `test-agent/verify` and writes three PR comments.

## Reading the three PR comments

- **Report** (`### <status>`): the status, confirmed Defects with expected and received values, skipped files, test results, coverage of changed files, and mutation results (information only).
- **Test author**: what the Author tested. Each Unit has a Verdict, a kind, its tests and the number of attempts. Defects the Author flagged are listed below.
- **Test reviewer**: the Reviewer's decision on each Defect, with the quote it used, and its Findings.

Read the quotes and the Intent sources they cite. The agents can be wrong.

## When a Defect is reported

A confirmed Defect means the code contradicts an Intent source. Fix the source code, then push. The workflow's agents never change source code; they report Defects. The next PR run writes the test again.

If you think the Intent source is wrong, fix the source in the same PR and explain why in the PR description. Do not change a test to match the code.

A rejected Defect is only a warning. Read the Reviewer's quote, then decide.

## Re-running the workflow

See [SOLUTION.md](SOLUTION.md#how-to-run-the-pr-workflow).

## The `skip-test-agent` label

Use it only as [ADR 0005](docs/adr/0005-gate-merges-on-test-agent-verify.md) describes. Who may apply it is also set there. The suites still run and still gate the merge.

## Conventions

- **Tests.** Test paths per package are in `TEST_PATHS` in [`.github/scripts/rules.ts`](.github/scripts/rules.ts). Package playbooks for the Author are in `.claude/skills/author-tests/`.
- **Commits.** Use Conventional Commits with a scope, for example `fix(backend): ...`.
- **Branches.** `feat/issue-<n>-<slug>`.
- **PR description.** Write the intended behaviour in it, and end with `Closes #<n>`. The test workflow reads the description as an Intent source.
- **Agent config.** During a PR run, the agents use the base branch's agent config. See [ADR 0004](docs/adr/0004-isolate-pr-code-from-secrets.md).

## Commands

Setup is in [README.md](README.md). Run these from the package folder, `backend/` or `frontend/`. All scripts are in each package's `package.json`.

| Command | Backend | Frontend |
|---|---|---|
| Tests | `npm test` | `npm test` |
| Tests with coverage | `npm run test:coverage` | `npm run test:coverage` |
| Typecheck | `npm run typecheck` | `npm run typecheck` |

## Local runs of the PR workflow

- `make trial` runs the PR workflow's steps locally against `main`. Set `BASE=<branch>` to compare with another branch. Commit your change first, and write the PR description to `.test-agent/pr-body.md`.
- `make hook-demo` asks an agent to edit `backend/src`, and checks that the write guard blocks it.
- Output goes to `.test-agent/`, which git ignores. Nothing is pushed or posted. `make clean` removes the output and keeps the PR description.
- Needs Node 24, `make`, `jq`, Docker running, and a logged-in Claude Code CLI. The runs use model tokens.

The steps are in the [Makefile](Makefile).
