# ADR 0011: Let the owner ignore source paths, with a reason, in one file

For reviewers and future maintainers: how a repo marks source it chose not to test, and why one file drives both the PR workflow and coverage.

## Context

`rules.ts` sorts each changed file into a candidate or a skip with a reason. Its skip rules are generic: tests, stories, generated code, config, docs, type-only files and barrels. Every other file under `src/` is source the Author must test.

The frontend's vitest config, inherited from the source repo, also left `src/design-system/**` out of coverage. The two lists disagreed. A PR that changed a design-system component sent it to the Author, yet its coverage never appeared in a report, and the Backfill, which works from coverage, never listed it as a gap. The 27 component files had no tests, and nothing said whether that was on purpose.

Each repo has code like this: shared UI shown in Storybook, a vendored client, a thin entry point. The owner should be able to say "not this, and here is why" once, and see it applied everywhere.

## Decision

1. `.github/scripts/contracts/ignored-paths.json` lists the ignored source. Each entry has a `package`, `paths` as globs relative to the package folder, and a `reason`. [`ignored-paths.schema.json`](../../.github/scripts/contracts/ignored-paths.schema.json) checks it, and a file that fails the check stops every script that loads `rules.ts`, so no path is ignored by a malformed entry.
2. `rules.ts` skips a source file under an ignored path as `ignored`, after the built-in rules: a test or a story there keeps its own reason. The Report lists the file with the owner's reason next to it.
3. Both packages' vitest configs add the same paths to `coverage.exclude`. The frontend reads the file only under vitest, because its Docker build copies only the `frontend/` folder.
4. The file lives in `.github/scripts/`, so the PR workflow reads the base branch's copy, like its scripts and agent config ([ADR 0004](0004-isolate-pr-code-from-secrets.md)). A PR cannot ignore its own code: a change to the list takes effect after the merge.
5. Ignoring a path is a decision. Add it in its own PR, with the reason in the PR description.

The first entry is `frontend/src/design-system/**`: shared presentational components, shown in Storybook, and replaced by `design-system/mocks` in the feature tests.

## Consequences

- The rules and the coverage numbers agree, and the reason for each ignored path is in one place and in every Report that skips it.
- Ignored code has no unit tests and no coverage floor. A bug there is found only by Storybook, by hand, or by a feature test that uses the real component.
- The `suites` job measures coverage in the PR's own tree, so a PR that edits the list changes its own coverage numbers, as editing its vitest config always could. Which files the agents test comes only from the base copy.
- Removing an entry brings the files back into coverage, and the next Backfill lists them as gaps.

## Status

Accepted.
