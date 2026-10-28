# ADR 0002: Test changed Units and write only test files

For reviewers and future maintainers: what a PR run covers, and what the Author may write.

## Context

A PR often changes many files. Most of the change is not logic: docs, config, types and generated code. Writing tests for the whole codebase on every PR would be slow, costly and noisy. Gaps in code that the PR does not touch are a separate problem.

The Author must not change product code. If it could, an agent could make a failing test pass by editing the code under test.

## Decision

- A PR run takes its Scope from the diff. `.github/scripts/rules.ts` decides which changed files are candidates and which are skipped, and why. Skipped files are listed in the report.
- Work is per Unit, not per file. Changed lines map to the Units that contain them. Lines outside any Unit map to the Units that use them.
- The Author writes tests only in the test paths defined in `rules.ts`. A write-guard hook refuses any other edit during the agent run. The commit job checks the patch again before it pushes. See [ADR 0004](0004-isolate-pr-code-from-secrets.md).
- A Unit whose change cannot alter behaviour gets the Verdict `not-needed`, with a reason from `author.schema.json`.
- Gaps in untouched code are not part of a PR run. They are handled by the Backfill, which the owner runs locally. See [SOLUTION.md](../../SOLUTION.md).

## Consequences

- Existing untested code stays untested until a Backfill pass. Changed code is tested on its PR.
- The report shows what was skipped and why, so nothing is dropped silently.
- A Unit is identified by its path and name. Names repeat across files, so a name alone is not enough.
- A `not-needed` verdict is not reviewed. The Reviewer runs only when there are tests or Defects to check. A wrong skip decision is therefore not caught by the second agent.
- A behaviour change that the Author reads as "no logic" is missed until a person reads the code.

## Status

Accepted.
