# ADR 0011: Let the owner ignore source paths, with a reason, in one file

For reviewers and future maintainers: how a repo excludes source from agent testing and coverage, who decides it, and why the list comes only from `main`.

## Context

`rules.ts` sorts each changed file into a candidate or a skip with a reason. Its built-in rules are generic: tests, stories, generated code, config, docs, type-only files and barrels. Every other file under `src/` is source the Author must test.

Every repo also has code it chooses not to unit-test: shared UI shown in Storybook, a vendored client, a thin entry point. That choice belongs to the owner. It should be made in one reviewed place, carry its reason, and apply to the agents and to coverage alike. Before this decision there was no such place: the frontend's vitest config, inherited from the source repo, left `src/design-system/**` out of coverage while `rules.ts` still sent it to the Author.

## Decision

1. **One file.** [`.github/scripts/contracts/ignored-paths.json`](../../.github/scripts/contracts/ignored-paths.json) lists the ignored source. Each entry has a `package`, `paths` as globs relative to the package folder, and a `reason`.
2. **The owner changes it, through a PR to `main`.** Ignoring a path is a decision: add it in its own PR, with the reason in the PR description.
3. **Read from `main` only.** The file lives in `.github/scripts/`, so a PR run reads the base branch's copy, like its scripts and agent config ([ADR 0004](0004-isolate-pr-code-from-secrets.md)). A PR cannot ignore its own code; a change to the list applies to the PRs after its merge.
4. **A reason is required and shown.** `rules.ts` skips a source file under an ignored path as `ignored`, and the Report lists the file with the entry's reason. The built-in rules come first: a test or a story under an ignored path keeps its own reason.
5. **It fails closed.** [`ignored-paths.schema.json`](../../.github/scripts/contracts/ignored-paths.schema.json) checks the file when `rules.ts` loads. An entry without a reason, or with an unknown package, stops every script that loads `rules.ts`, so no path is ignored by a malformed entry.
6. **Coverage follows the same list.** Both packages' vitest configs add the paths to `coverage.exclude`. The frontend reads the file only under vitest, because its Docker build copies only the `frontend/` folder.

The first entry is `frontend/src/design-system/**`: shared presentational components, shown in Storybook, and replaced by `design-system/mocks` in the feature tests.

## Consequences

- An owner can exclude code on demand, with one entry, and every Report that skips it says why.
- The agents' scope and the coverage numbers come from one list, so they agree.
- Ignored code has no unit tests and no coverage floor. A bug there is found only by Storybook, by hand, or by a feature test that uses the real component.
- The vitest configs read the file from the checkout under test: in `suites`, the PR head, not `main`. A PR that edits the list changes only its own coverage numbers, as editing its vitest config always could. Which files the agents test comes only from `main`'s copy.
- Removing an entry brings the files back into coverage, and the next Backfill lists them as gaps.

## Status

Accepted.
