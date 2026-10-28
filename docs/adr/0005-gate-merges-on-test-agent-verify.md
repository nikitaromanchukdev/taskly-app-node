# ADR 0005: Gate merges on test-agent/verify

For reviewers and maintainers: how the status is decided, how the merge gate is set, and why the `skip-test-agent` label exists.

## Context

The workflow must block a merge when a confirmed Defect or a failing suite exists. It must not block a developer because the bot itself failed. The gate has to be enforced by GitHub, not only shown in a comment.

Some PRs gain nothing from the agent, and some must merge quickly. They need a way to skip the agent. That way must not become a bypass for the suites.

## Decision

- The workflow posts one status, `test-agent/verify`. It is pending when a PR run starts, and it is decided at the end, on the final commit of the run.
- The status is red when any of these holds:
  - `prepare` failed, for example because a budget variable is missing;
  - typecheck or a test suite fails;
  - the Author or the Reviewer crashed, timed out, returned invalid output, its patch was rejected, or the commit step failed, while there were candidate files;
  - verification did not finish;
  - a Defect is confirmed.
- Otherwise the status is green. That includes "no candidate files", rejected Defects, `review-rejected` Units, and a skip by label. Suites must still pass on a skip by label.
- The merge gate is a ruleset on the default branch. It requires a pull request, requires the status from GitHub Actions, blocks force pushes and branch deletion, and has no bypass actors. It requires no review approvals. The ruleset file is `.github/rulesets/main.json`.
- The `skip-test-agent` label skips the Author and the Reviewer for a PR run. It exists for:
  - dependency or lockfile bumps;
  - reverts;
  - mechanical renames or moves across many files, where the agent would churn tests for unchanged behaviour;
  - an urgent hotfix where a person has already written the tests;
  - tooling PRs that change `.claude/` or `.github/`, which cannot test their own agent config (see [ADR 0004](0004-isolate-pr-code-from-secrets.md)).
- Only admins and maintainers make the label count. The run looks up who added the label last and that person's repo permission. If that lookup fails, the admin-set variable `TEST_AGENT_SKIP_ACTORS` (comma-separated logins) decides instead. A label from anyone else does nothing: no run, and the status is unchanged.
- A label that counts shows in the status and the report as "skipped by label" with the actor's login.
- Removing the label starts a normal run when the current status says the head was skipped by label. Adding any other label starts nothing.

## Consequences

- A maintainer can skip the agent, but cannot skip the suites.
- The skip is visible in the status and the report, so it shows in the PR history.
- Only the status gates merges. Findings and mutation results are advisory and never change the status.
- The repo owner is an admin, so the sole maintainer is not blocked by the label rule.
- Setup of the label and the ruleset is described in [SOLUTION.md](../../SOLUTION.md).

## Status

Accepted.
