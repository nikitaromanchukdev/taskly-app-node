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
   - `expected.json`: the Verdict the Author must give each Unit, and the decision the Reviewer must give each Defect.
2. `make demo` creates a throwaway worktree and copies in the agent config from disk, committed or not, using the same paths CI takes from the base branch. It applies the case's change there, runs the trial steps, and compares the result with `expected.json`. It prints PASS or FAIL with each mismatch, then removes the worktree.
3. The first case is `truncate`: text of exactly `max` characters is cut when it should not be. It must end as `flagged-defect`, and the Reviewer must confirm it.
4. `make demo` runs by hand, not in CI. A PR that changes the agent config shows a PASS in its Evidence.
5. The intent of a case is always written by a person, never generated from the code. A summary of the code would describe the planted Defect as intended, and no test could contradict it ([ADR 0003](0003-derive-expectations-from-intent-and-review-defects.md)).
6. `.github/` is `config` in `rules.ts`, so a PR run never treats a case as code to test. The patch is applied only inside the throwaway worktree.

## Consequences

- A change to the agent config can be tested before it merges, by anyone with a clone, with one command and a clear result.
- One case proves that the agents still catch one known Defect, not that every behaviour is right. More cases can be added as folders, for example a tautological test the Reviewer must block.
- A model can fail a run by chance. A FAIL is rerun once before anyone concludes the config is broken.
- Nothing enforces the run. It is a review rule, listed under limitations in [SOLUTION.md](../../SOLUTION.md).
- Each run costs two agent runs' worth of tokens.

## Status

Accepted.
