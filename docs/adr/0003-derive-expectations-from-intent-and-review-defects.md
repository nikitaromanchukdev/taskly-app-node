# ADR 0003: Derive Expectations from intent and review Defects

For reviewers and future maintainers: where expected values come from, and what happens when a test fails.

## Context

An agent that takes expected values from running the code writes tests that agree with the code. Such tests pass and catch nothing.

A test that fails against the code can mean two things: the code has a real bug, or the agent misread the intent. The second case is the bigger risk here. A red status caused by a misread blocks a person for no reason. Agents are not deterministic, so one agent cannot be trusted to check its own reading.

## Decision

1. Expectations come from Intent sources, looked up in this order: the PR title and body; `backend/openapi.json`; neighbouring existing tests; README and docs. A file generated from the code is the code, not an Intent source. The steps are in `.claude/skills/extract-intent/SKILL.md`.
2. An Expectation with no Intent source may still get a Characterization test. Its name starts with `characterization: `. Each Expectation lists its kind and its tests, and `agent-output.ts` rejects the Author's output when a test's name and its Expectation's kind disagree. The report labels each Unit intent, characterization or mixed.
3. A test that still fails after the attempt budget becomes a flagged Defect. It is not committed. The other tests of its Unit are.
   An existing test that the change broke is updated only when the break is in its setup (fakes, mocks, providers, types), or when an Intent source states the new behaviour. Otherwise it is a possible regression: it stays as it is, failing, and is reported as a Defect.
4. A second agent, the Reviewer, runs in a fresh session, on its own model set by its own repo variable. It checks each test against the Intent source the test cites. A tautology is a test that cannot fail when the Unit is wrong. One assertion that another assertion in the same test already covers is only redundant and is not a Finding: it often checks the outcome, while the other checks the mechanism. It confirms or rejects every flagged Defect. A confirmed Defect must quote an Intent source.
5. Only a confirmed and proven Defect makes the status red. A rejected Defect is a warning. A Defect is proven when a trusted script reads the run of its test and finds that the test failed with an assertion error that shows the Author's expected and received values. They are compared loosely: white space, quotes and case are ignored, and a value written in prose ("ids [2, 3, 1]: …") matches by the literals in it, because the runner prints only the value. A pass, a TypeError, an import error, a timeout, or a failure with other values leaves it unproven. A confirmed Defect that is unproven is shown in the Report as a warning and does not change the status. A confirmed Defect whose test is missing from the patch (the Author removed it) cannot be proven, so it makes the status red ([ADR 0005](0005-gate-merges-on-test-agent-verify.md)). The test runs in `suites` on a copy of the final tree with no network where the runner allows it, because the Defect test is left out of the Bot commit (point 3).
6. A blocking Finding removes the whole test file from the Bot commit. The Units in that file get the report-only state `review-rejected`. That state does not turn the status red.
   A Unit whose own output fails a check of `agent-output.ts` gets the same treatment, as `check-rejected` ([ADR 0010](0010-reject-one-unit-not-the-run-for-its-own-slip.md)). Which checks reject one Unit and which the whole run is decided there.
7. There is no revise round. A push costs at most two model runs. The Author does not get a second attempt after review.

## Consequences

- A wrong PR body or a wrong contract gives wrong Expectations. The Reviewer checks against the same source, so it cannot catch a wrong source.
- The Reviewer is a model too, and dropping a whole file also drops its good tests. Both are listed under limitations in [SOLUTION.md](../../SOLUTION.md).
- A confirmed Defect is a real red status once its test is proven. The developer fixes the code and pushes. The next PR run writes the test again. When the test is missing, the Author erred: the developer re-runs the workflow.
- One run per agent step and no loop keep cost and run time bounded. See [ADR 0006](0006-set-budgets-as-admin-only-repo-variables.md).

## Status

Accepted.
