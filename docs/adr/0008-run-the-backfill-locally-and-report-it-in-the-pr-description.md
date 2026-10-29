# ADR 0008: Run the Backfill locally and report it in the PR description

For reviewers and future maintainers: where the Backfill runs, where its results appear, and what the PR workflow does on a PR that only adds tests.

## Context

The PR workflow tests only the Units a PR changes ([ADR 0002](0002-test-changed-units-and-write-only-tests.md)). Code that existed before it has no tests until a Backfill pass.

The Backfill differs from a PR run in two ways:
- Its Scope is the whole codebase. The owner must approve a ranked list of gaps before any test is written, so the run stops halfway and waits for a person.
- Its PR changes only test files and coverage floors. `rules.ts` skips all of them, so the PR workflow finds no candidates on that PR and its agents do not run.

The PR workflow's Test author and Test reviewer comments on such a PR said only that the agent did not run. On a Backfill PR that was misleading: the Author and the Reviewer did run, locally, and their results were somewhere else.

## Decision

1. The owner runs the Backfill locally with Claude Code, not in GitHub Actions: `map-coverage-gaps`, then the owner's approval, then the Author, then the Reviewer in a fresh session. Both agents use the same agent files, skills and schemas as in a PR run, and `agent-output.ts` checks their output. Two make commands run it, because the run stops for approval in the middle: `make backfill-gaps` returns the gap list as structured output (`gaps.schema.json`) and asks which items to approve; `make backfill-tests` runs the Author on the approved items, then the Reviewer and the checks, and measures coverage before and after.
2. Each package gets its own Backfill PR. The PR description holds the results: the approved gaps, the unreachable and out-of-scope lists, each Unit's Verdict, the Reviewer's decisions and Findings, coverage before and after, and a local mutation run. Per-file coverage floors keep the new coverage from regressing.
3. Defects and Suspected Defects go in one Defects comment, which the person who opens the PR posts ([ADR 0007](0007-report-defects-next-to-the-code-with-a-suggested-fix.md)).
4. On a PR that changes only tests and config, such as a Backfill PR, the PR workflow still writes all three comments. The Test author and Test reviewer comments say why the agents did not run: there is nothing new to test, and a Backfill PR runs them locally and lists their results in its description. Both link this ADR.
5. A Backfill PR passes the same merge gate as any PR: typecheck and both suites must pass ([ADR 0005](0005-gate-merges-on-test-agent-verify.md)).

## Consequences

- The owner sees the gap list and approves it before any tokens are spent on tests. A run in CI could not wait for that approval.
- No CI run proves the Backfill's agent results. The PR description is written from the local `author.json` and `reviewer.json`, by hand, so it can drift from them. A script that renders the description from those files is a production item.
- The wording in decision 4 appears on every PR that changes only tests and config, not only on Backfill PRs. Such a PR has nothing for the agents to test either way.
- A Backfill PR gets four PR comments: the three of the PR workflow and the Defects comment.

## Status

Accepted.
