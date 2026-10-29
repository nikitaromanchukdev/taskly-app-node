# ADR 0009: Test agent config changes against committed cases before the merge

For reviewers and future maintainers: how a change to the agents, their skills or the workflow scripts is tested before it merges.

## Context

A PR run uses the base branch's agent config, never the PR's ([ADR 0004](0004-isolate-pr-code-from-secrets.md)). That keeps a PR from rewriting the agents that judge it. It also means a PR that changes `.claude/` or `.github/scripts/` is tested with the old config in its own run, and the new config is first used on the next PR after the merge.

`make trial` runs the agents locally with the config on disk. It needs a committed change to test and a person's statement of the intended behaviour. Before this decision, the only known-good example was a change with a planted Defect that existed on one machine, outside git. Nobody else could repeat it, and nobody could tell from the output alone whether a run had passed.

Agent runs cost model tokens, and the models do not give the same answer every time.

## Decision

1. Each case is a folder under `.github/agent-tests/`:
   - `change.patch`: a code change with a known Defect;
   - `pr-body.md`: the intended behaviour the change breaks, written by a person;
   - `expected.json`: what the run must produce: the Verdict for each Unit, the Reviewer's decision for each Defect, the Findings the Reviewer must record, and the exact list of dropped test files. A case lists only what it checks.
   - for a review-only case, `tests.patch` and `author.json`: the Author's work, written by a person, so the case tests the Reviewer and `bot_commit`'s checks without an Author run.
2. `make demo` runs every case; `make demo CASE=<name>` runs one. For each case it creates a throwaway worktree and copies in the agent config from disk, committed or not, using the same paths CI takes from the base branch. It applies the case's change there, runs the trial steps, and compares the result with `expected.json`. It prints PASS or FAIL with each mismatch, then removes the worktree.
3. The cases:
   - `truncate`: text of exactly `max` characters is cut when it should not be. It must end as `flagged-defect`, and the Reviewer must confirm it.
   - `tautology` (review-only): the code is right, and one of two test files holds a test that calls a mock it set up itself, never the code. The Reviewer must record a blocking `tautology` Finding, and only that file may be dropped from the patch.
4. `make demo` runs by hand, not in CI. A PR that changes the agent config shows a PASS in its Evidence.
5. The intent of a case is always written by a person, never generated from the code. A summary of the code would describe the planted Defect as intended, and no test could contradict it ([ADR 0003](0003-derive-expectations-from-intent-and-review-defects.md)).
6. `.github/` is `config` in `rules.ts`, so a PR run never treats a case as code to test. The patch is applied only inside the throwaway worktree.

## Consequences

- A change to the agent config can be tested before it merges, by anyone with a clone, with one command and a clear result.
- The cases prove that the agents still catch a known Defect and a known tautology, not that every behaviour is right. More cases can be added as folders.
- A model can fail a run by chance. A FAIL is rerun once before anyone concludes the config is broken.
- Nothing enforces the run. It is a review rule, listed under limitations in [SOLUTION.md](../../SOLUTION.md).
- Each run costs two agent runs' worth of tokens.

## Status

Accepted.
