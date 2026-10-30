# Terminology

For everyone who works on or reads the PR workflow or the Backfill: the terms the agents, skills, scripts and docs use.

Use these words as written. Each entry lists words to avoid.

## Unit

The code a test targets: an exported function, a React component, a hook, or an Express route. A Unit is identified by its file path and its name together, because names such as `default` repeat across files.

Avoid: module, file.

## Expectation

One sentence that says what a Unit should do, in the form "when X, then Y". Each Expectation names its Intent source. One test checks one Expectation.

Avoid: requirement, criterion, assertion.

## Intent source

A document or test that states what a Unit should do: the PR title and body, the OpenAPI contract, a neighbouring test, or the README and docs. Each Expectation cites one. The order in which the Author looks for them is in [ADR 0003](docs/adr/0003-derive-expectations-from-intent-and-review-defects.md).

Avoid: spec, source of truth, ground truth.

## Verdict

The Author's decision for one Unit. The allowed values are in `.github/scripts/contracts/author.schema.json`.

Avoid: status (that word means the commit status), result, outcome.

## Defect

A Unit whose Expectation the code contradicts. A test that still fails after the attempt budget becomes a Defect. A failing test is never committed. A Defect has three states:

- **flagged**: the Author reports it, with the expected and received values and the Intent source. Verdict `flagged-defect`.
- **confirmed**: the Reviewer quotes an Intent source that states the expected behaviour, and the code contradicts it. A confirmed Defect makes the status red once it is proven.
- **rejected**: the Reviewer finds no Intent source for the Expectation, or finds that the test is wrong. A rejected Defect is a warning only.

A confirmed Defect is also **proven** or **unproven**. Proven: a trusted script saw its test fail with an assertion that shows the expected and received values. Unproven: it did not (the test passed, died with an error, or failed with other values), and the Report says why. Only a proven Defect makes the status red.

Avoid: bug (a Defect is a claim until it is confirmed), failing test, issue.

## Suspected Defect

Behaviour that looks wrong but that no Intent source states, so nothing confirms or rejects it. It never changes the status. It waits for the owner to decide which behaviour is intended. See [ADR 0007](docs/adr/0007-report-defects-next-to-the-code-with-a-suggested-fix.md).

Avoid: bug, owner note, open question.

## Characterization test

A test that records what the code does now. It is used only when no Intent source states the behaviour. Its name starts with `characterization: `. `agent-output.ts` rejects the Author's output when a test's name and its Expectation's kind disagree, and the report shows each Unit's kind.

Avoid: snapshot test, golden test, intent test (for a test that is not backed by an Intent source).

## Author

The agent that writes and proves tests for Units in a PR run or in a Backfill. It writes test files only. Its agent file is `.claude/agents/pr-test-engineer.md`.

Avoid: test agent (that name covers the whole workflow), engineer (the agent file and the workflow are named `pr-test-engineer`; the job that runs the agents is `agents`), writer.

## Reviewer

The second agent in a PR run and in a Backfill. It runs in a fresh session, reads the Author's tests and flagged Defects, and cannot edit files or run commands. Its agent file is `.claude/agents/pr-test-reviewer.md`.

Avoid: critic, checker, verifier (`test-agent/verify` is the status).

## Finding

A note from the Reviewer about one test. Each Finding has a severity. A blocking Finding removes its test file from the Bot commit. An advisory Finding appears in the Reviewer comment only.

Avoid: issue, warning (a rejected Defect is the warning), comment.

## Review-rejected

A report-only state for a Unit whose test file was dropped from the Bot commit because of a blocking Finding. The Author cannot set it; `.github/scripts/workflow/agent-output.ts` computes it. It does not turn the status red.

Avoid: rejected (that word belongs to a Defect), failed, dropped.

## PR workflow

The GitHub Actions workflows `pr-intake` and `pr-test-engineer`, which add or update tests for the Units each PR changes, on every push. `pr-intake` only records the PR event; `pr-test-engineer` does the work. Each execution of `pr-test-engineer` is a PR run.

Avoid: Part B, PR test workflow, pipeline.

## PR run

One execution of the PR workflow for one PR head, through the `intake`, `scope`, `agents`, `bot_commit`, `suites` and `publish` jobs. A push starts a new PR run and cancels the older run for the same PR. A manual dispatch also starts a PR run.

Avoid: build, CI run, check run.

## Bot commit

The commit that the `github-actions[bot]` account adds to the PR branch with the Author's tests. A Bot commit starts no agent run: GitHub creates a `pr-intake` run for it that waits for approval, and that run does nothing.

Avoid: auto-commit, agent commit, fix commit.

## Scope

The files one PR run looks at. It comes from the diff between the base and the PR head, sorted into candidate files and skipped files, and is written to `scope.json`. For a Backfill, the Scope is the whole codebase.

Avoid: diff, change set, changeset.

## Backfill

A one-off local pass that adds tests for existing, untested code. The owner approves a ranked list of gaps before any test is written. The Author writes the tests, and the Reviewer reviews them, as in a PR run. Backfill PRs go through the same merge gate as any other PR. See [ADR 0008](docs/adr/0008-run-the-backfill-locally-and-report-it-in-the-pr-description.md).

Avoid: Part A, catch-up, retroactive tests, gap fill.
