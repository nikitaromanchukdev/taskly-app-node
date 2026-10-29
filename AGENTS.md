# Working in this repo

For contributors and coding agents who change the app, its tests, or the PR workflow.

The agents of the PR workflow and the Backfill follow their own agent files, which take precedence over this file. They never commit, push, post, or run npm on the host. The push, commit and command steps below are for people.

## Before you explore

- **Terms.** Read [TERMINOLOGY.md](TERMINOLOGY.md) and use its terms as written, not the synonyms it lists. If a concept has no term there, say so instead of inventing one.
- **Decisions.** Read the ADRs in [`docs/adr/`](docs/adr/) that touch the area you change. If your change contradicts one, say which and why in the PR description, and update the ADR in the same PR. Never override an ADR silently.
- **Rules live in code.** Test paths and skip rules are in [`.github/scripts/contracts/rules.ts`](.github/scripts/contracts/rules.ts); Verdicts, reasons and kinds in [`author.schema.json`](.github/scripts/contracts/author.schema.json) and [`reviewer.schema.json`](.github/scripts/contracts/reviewer.schema.json); the status policy in [`status.ts`](.github/scripts/workflow/status.ts). Link them; never copy their lists into a doc.
- **One home per fact.** Why: an ADR. How to run and what was built: [SOLUTION.md](SOLUTION.md). How to work: this file. Terms: TERMINOLOGY.md. Change a fact in its home and link to it from elsewhere.

## What happens when you push to a PR

- The PR workflow runs on each push. Its jobs and triggers are in [SOLUTION.md](SOLUTION.md); one run step by step is in [docs/pr-run.md](docs/pr-run.md).
- On a draft PR the agents do not run; only the suites do. Open the PR as a draft while you iterate, and mark it ready for review when the change is done.
- It may add one Bot commit with tests to your branch. Run `git pull --rebase` before your next push, or your push will be rejected.
- GitHub then asks to approve a workflow run for the Bot commit. Approving it or not changes nothing: that run skips every job.
- It sets the status `test-agent/verify` and writes three PR comments. Defects and Suspected Defects appear as review comments on the changed code.

## Reading the PR comments

- **Report** (`### <status>`): the status, the counts of confirmed Defects and Suspected Defects with a link to their review comments, skipped files, test results, coverage of changed files, and mutation results (information only).
- **Test author**: what the Author tested. Each Unit has a Verdict, a kind (intent, characterization, or mixed with the number of tests of each), its tests and the number of attempts. Each Defect the Author flagged is one line, with a link to its review comment.
- **Test reviewer**: the Reviewer's decision on each Defect, with a link to its review comment, and its Findings.
- **Review comments on the code**: one per Defect or Suspected Defect, on the line where it was found, with expected and received values (or what looks wrong), the Intent source quote, the Reviewer's decision or note, and a suggested fix. This is the only place with a Defect's details. See [ADR 0007](docs/adr/0007-report-defects-next-to-the-code-with-a-suggested-fix.md).

On a PR that changes only tests and config, such as a Backfill PR, the agents have nothing to test, and the Test author and Test reviewer comments say so. A Backfill PR lists the Author and Reviewer results in its description. It has no changed source lines, so its Defects go in a fourth comment, **Defects**, with the same entries. See [ADR 0008](docs/adr/0008-run-the-backfill-locally-and-report-it-in-the-pr-description.md).

Read the quotes and the Intent sources they cite. The agents can be wrong.

## When a Defect is reported

A confirmed Defect means the code contradicts an Intent source. Fix the source code, then push. The workflow's agents never change source code; they report Defects. The next PR run writes the test again.

The review that holds a confirmed Defect requests changes. The next PR run that finds no confirmed Defect dismisses it. The merge gate is still the status.

Each review comment suggests a fix. Nothing applies it. Commit the suggestion as it is, change it, or write your own fix.

If you think the Intent source is wrong, fix the source in the same PR and explain why in the PR description. Do not change a test to match the code.

A rejected Defect is only a warning. Read the Reviewer's quote, then decide.

A Suspected Defect is behaviour that looks wrong but that no Intent source states. It never changes the status. Decide which behaviour is intended: fix the code, or state the current behaviour in the PR description.

## Re-running the workflow

See [SOLUTION.md](SOLUTION.md#how-to-run-the-pr-workflow).

## The `skip-test-agent` label

Use it only as [ADR 0005](docs/adr/0005-gate-merges-on-test-agent-verify.md) describes. Who may apply it is also set there. The suites still run and still gate the merge.

## Merging without the gate

Admins only, and only for the cases in [ADR 0005](docs/adr/0005-gate-merges-on-test-agent-verify.md): a PR that changes the workflow's own scripts or paths, or an urgent fix while Actions or the model API is down. Split the change instead when you can. Comment on the PR with the reason and the checks you ran, then merge with `gh pr merge <n> --admin`.

## Conventions

- **Tests.** Test paths per package are in `TEST_PATHS` in [`.github/scripts/contracts/rules.ts`](.github/scripts/contracts/rules.ts). Package playbooks for the Author are in `.claude/skills/author-tests/`.
- **Commits.** Use Conventional Commits with a scope, for example `fix(backend): ...`.
- **Branches.** `feat/issue-<n>-<slug>`.
- **PR description.** Write the intended behaviour in it, and end with `Closes #<n>`. The test workflow reads the description as an Intent source.
- **Agent config.** During a PR run, the agents use the base branch's agent config. See [ADR 0004](docs/adr/0004-isolate-pr-code-from-secrets.md).
- **Script code.** Branch with `switch` or lookup tables, not `if` chains. Declare named union types first and use them; do not derive them with `(typeof X)[number]`, `T['field']` or `ReturnType`.

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

The workflow's own scripts in `.github/scripts/` have their own tests: run `make script-tests` from the repo root. They need Node 24 and no install. `suites` runs them on every PR.

## Local runs of the PR workflow

- `make trial` runs the PR workflow's steps locally against `main`. Set `BASE=<branch>` to compare with another branch. Commit your change first: the trial tests `git diff main...HEAD`.
- The first run on a branch asks where the intended behaviour comes from: the open PR's description, the branch's commit messages, typed in, your editor, or none. Without intent, Defects can only come from `openapi.json`, existing tests or docs. The answer is saved and reused for that branch. Delete `.test-agent/<branch>/pr-body.md` to be asked again.
- `make demo` checks the agent config on disk, committed or not, against the cases in [`.github/agent-tests/`](.github/agent-tests/): a planted Defect the agents must flag and confirm, and a tautological test the Reviewer must block. It prints `demo: PASS` or `demo: FAIL` per case; `make demo CASE=<name>` runs one. Run it before you open a PR that changes `.claude/` or `.github/scripts/`: that PR's own run uses `main`'s copy ([ADR 0004](docs/adr/0004-isolate-pr-code-from-secrets.md)), so nothing else tests the new config before the merge ([ADR 0009](docs/adr/0009-test-agent-config-changes-against-committed-cases.md)).
- **Backfill**, one package at a time: `make backfill-gaps PACKAGE=<backend|frontend>` has the Author rank the coverage gaps and asks which to approve; `make backfill-approve PACKAGE=… APPROVE=1,3` picks or changes them without a new agent run; `make backfill-tests PACKAGE=…` tests the approved items, reviews the tests, and measures coverage before and after. Commit your changes first. See [ADR 0008](docs/adr/0008-run-the-backfill-locally-and-report-it-in-the-pr-description.md).
- `make hook-demo` asks an agent to edit `backend/src`, and checks that the write guard blocks it.
- Output goes to `.test-agent/<branch>/`, which git ignores. Nothing is pushed or posted. `make clean` removes the current branch's output and keeps its PR description and approved gap list; if the branch has none, it lists the other folders to pick from.
- Needs Node 24, `make`, `jq`, `rsync`, Docker running, and a logged-in Claude Code CLI. `make trial` and `make demo` use model tokens.

The steps are in the [Makefile](Makefile).
