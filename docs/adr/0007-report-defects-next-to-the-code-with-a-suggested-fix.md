# ADR 0007: Report Defects next to the code with a suggested fix

For reviewers and future maintainers: how the PR workflow and the Backfill hand a found bug to a person.

## Context

Agents write only test files and never change source code ([ADR 0002](0002-test-changed-units-and-write-only-tests.md)). The Backfill writes tests for code that already exists; changing that code is not its job. In the PR workflow, a person fixes a confirmed Defect and pushes ([ADR 0003](0003-derive-expectations-from-intent-and-review-defects.md)).

So a person always makes the fix, but today they get little help with it:
- A Defect is one row in the Report comment, among test results, coverage and mutation results.
- The Author has read the code and knows where it goes wrong, but that knowledge ends up only in its free-text summary, if at all.
- The Backfill's first run found behaviour that no Intent source states but that looks wrong. An example is the frontend overdue check, which uses the local date while the backend counter uses UTC. Such findings are not Defects under ADR 0003, so they were left as notes in the PR body, where they are easy to miss.

In the PR workflow the bug is in code the PR changes, so the best place to show it is on that code, where the PR owner already reviews. A Backfill PR changes only tests, so its bugs have no changed line to sit on.

## Decision

1. Two kinds of entries are reported:
   - **Defects**, flagged, confirmed or rejected, with the state the Reviewer gave them.
   - **Suspected Defects**: behaviour that looks wrong but that no Intent source states. They are marked "needs owner decision" and never change the status.
2. Each entry contains:
   - the file and line, pinned to the analyzed commit;
   - the Unit;
   - expected and received values, or for a Suspected Defect, what looks wrong and why;
   - the Intent source quote, if there is one;
   - a **suggested fix**.
3. Where an entry appears depends on the part. Each entry appears in one place only.
   - **PR workflow:** each entry is a review comment on the changed file, at its line. `publish` posts them together as one PR review. The review requests changes when it holds a confirmed Defect, and is a plain comment otherwise. When a later PR run finds no confirmed Defect, `publish` dismisses its earlier review that requested changes. The merge gate stays the status ([ADR 0005](0005-gate-merges-on-test-agent-verify.md)); the review only shows the same result in the PR's review panel. When the line is outside the diff's hunks, the comment goes on the file instead. Entries in files the PR does not change are not reported, because the PR workflow looks only at changed Units. There is no Defects comment.
   - **Backfill:** one **Defects comment** on the PR lists every entry, confirmed Defects first. The person who opens the PR posts it.
4. The suggested fix is the Author's text in its structured output, written against the file where it found the behaviour. On a review comment that covers the lines it replaces, it is a GitHub `suggestion` block, so the PR owner can commit it in one click. Everywhere else it is a `diff` block. Nothing applies it on its own: the PR owner applies it as it is, changes it, or writes their own fix. The agents' write rules do not change: test files only.
5. The Reviewer checks every entry, including Suspected Defects and suggested fixes, and may add a note to each. A Suspected Defect stays one until an Intent source states the behaviour. Usually that is a PR description that says which behaviour is intended.
6. A script renders every entry from the agents' structured output and sanitizes it like the other comments. Each review comment carries a hidden key (path, Unit, kind). On the next PR run, `publish` does not post an entry again when a comment with the same key is already on the same line. When an earlier entry is no longer found, `publish` replies "not found on `<sha>`" to its comment instead of deleting it, so the discussion stays.
7. The Report comment keeps its one-line status and the counts of confirmed Defects and Suspected Defects. In the PR workflow it links to the review; in the Backfill, to the Defects comment.
8. The details of an entry appear in one place only: its review comment, or in the Backfill, the Defects comment. The Test author and Test reviewer comments keep one line per Defect, with the Unit, the Reviewer's decision and a link to the entry. The Report no longer lists expected and received values.

## Consequences

- A person sees each bug where the code is, with one way to fix it. The fix remains their decision and their commit.
- The suggested fix is model output. It can be wrong, and it can be steered by the PR body. It is never applied by the workflow, and it is sanitized like other agent text. A `suggestion` block makes a wrong fix easy to commit, so the PR owner must still read it.
- The PR workflow keeps three PR comments, plus review comments on the code. A Backfill PR has no changed source lines, so it gets a fourth comment, the Defects comment ([ADR 0008](0008-run-the-backfill-locally-and-report-it-in-the-pr-description.md)).
- `author.schema.json` gets the file, line range and suggested fix for each Defect, plus a list of Suspected Defects. `reviewer.schema.json` gets a decision or note for each Suspected Defect. `agent-output.ts` checks that every entry names a Unit and a file that exist, and drops PR-workflow entries in files the PR does not change.
- `render.ts` drops the Defect details from the Report, Test author and Test reviewer comments, and links each Defect to its entry instead.
- GitHub accepts line comments only on lines in the diff, so `publish` must map each entry to a diff hunk or fall back to a file comment.
- A review that requests changes stays on the PR until it is dismissed, so `publish` needs the id of its earlier review on every PR run.
- A Suspected Defect needs judgement where no source exists, so the Author may report noise. The Reviewer's note and the "needs owner decision" label keep it from blocking anyone.

## Status

Proposed. Not built yet.
