# ADR 0005: Gate merges on test-agent/verify

For reviewers and maintainers: how the status is decided, how the merge gate is set, why the `skip-test-agent` label exists, and when an admin may bypass the gate.

## Context

The workflow must block a merge when a confirmed Defect or a failing suite exists. It must not block a developer because the bot itself failed. The gate has to be enforced by GitHub, not only shown in a comment.

Some PRs gain nothing from the agent, and some must merge quickly. They need a way to skip the agent. That way must not become a bypass for the suites.

A few PRs cannot pass the gate at all, through no fault of their own. A PR run uses the base branch's scripts (ADR 0004), so a PR that moves or renames those scripts runs its new workflow against the old layout and can post no status. Without a bypass, the only way to merge it is to switch the whole gate off.

## Decision

- The workflow posts one status, `test-agent/verify`. It is pending once `scope` has read the PR, and it is decided at the end, on the final commit of the run. Because `pr-intake` runs first ([ADR 0004](0004-isolate-pr-code-from-secrets.md)), the pending status appears about a minute after the push. Until then the ruleset shows the required status as expected, and the merge stays blocked.
- The status is red when any of these holds:
  - `scope` failed, for example because a budget variable is missing;
  - typecheck or a test suite fails;
  - the Author or the Reviewer crashed, timed out, returned invalid output, its patch was rejected, or the `bot_commit` job failed, while there were candidate files;
  - verification did not finish;
  - a Defect is confirmed.
- The status is green only if the `suites` job succeeded. That job fails when a typecheck or suite fails, and GitHub reports its result. `results.json` comes from a job that ran PR code, so it can add red reasons and never remove one.
- Otherwise the status is green. That includes "no candidate files", rejected Defects, `review-rejected` Units, and a skip by label. Suites must still pass on a skip by label.
- The merge gate is a ruleset on the default branch. It requires a pull request, requires the status from GitHub Actions on a branch that is up to date with the default branch (a green status from an older base does not count), blocks force pushes and branch deletion, and requires no review approvals. Its only bypass actor is the repository admin role, in pull-request mode: an admin can merge a PR without the status, but cannot push to the default branch directly. The ruleset file is `.github/rulesets/main.json`.
- The `skip-test-agent` label skips the Author and the Reviewer for a PR run. It exists for:
  - dependency or lockfile bumps;
  - reverts;
  - mechanical renames or moves across many files, where the agent would churn tests for unchanged behaviour;
  - an urgent hotfix where a person has already written the tests;
  - tooling PRs that change `.claude/` or `.github/`, which cannot test their own agent config (see [ADR 0004](0004-isolate-pr-code-from-secrets.md)).
- Only admins and maintainers make the label count. The run looks up who added the label last and that person's repo permission. If that lookup fails, the admin-set variable `TEST_AGENT_SKIP_ACTORS` (comma-separated logins) decides instead. A label from anyone else does nothing: no run, and the status is unchanged.
- A label that counts shows in the status and the report as "skipped by label" with the actor's login.
- The admin bypass is a break-glass path, not a faster label. It is used only for:
  - a PR that changes the workflow's own scripts or paths, so its run cannot pass by design (for example, moving `.github/scripts/`);
  - an urgent fix while GitHub Actions or the model API is down;
  - a PR that changes `pr-test-engineer.yml` or `pr-intake.yml`. The workflow runs from the default branch, so the PR's own run is the old workflow or none, and the new one cannot post the status.
- A change that can be split is split instead, the way a database migration is: first a PR that adds the new form next to the old one, then a PR that removes the old one. Each PR then passes the gate on its own.
- Before a bypassed merge, the admin comments on the PR with the reason and the checks they ran in place of the gate. The merge uses `gh pr merge <n> --admin`, or the "bypass rules" option of the merge button.
- The label event starts `pr-intake`, which passes the action and the label to `pr-test-engineer`; the permission lookup above happens there. Any other label is recorded as ignored and starts no run.
- A manual dispatch (`gh workflow run pr-test-engineer.yml -f pull-request=<n>`) re-runs a PR on its live head. It is accepted only from `main`.
- Removing the label starts a normal run when the current status says the head was skipped by label. Adding any other label starts nothing.

## Consequences

- A maintainer can skip the agent, but cannot skip the suites. Only an admin can merge without the suites, through the bypass.
- The repo owner is the only admin, so for them the gate is advisory: they can bypass a red PR. GitHub shows every bypass on the PR and in the audit log, and the reason comment makes it reviewable. In a team, the bypass actor would be a small release-manager team, and bypasses would be reviewed afterwards.
- The skip is visible in the status and the report, so it shows in the PR history.
- Only the status gates merges. Findings and mutation results are advisory and never change the status.
- The repo owner is an admin, so the sole maintainer is not blocked by the label rule.
- Setup of the label and the ruleset is described in [SOLUTION.md](../../SOLUTION.md).

## Status

Accepted.
