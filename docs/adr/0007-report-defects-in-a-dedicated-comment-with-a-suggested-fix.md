# ADR 0007: Report Defects in a dedicated comment with a suggested fix

For reviewers and future maintainers: how the PR workflow and the Backfill hand a found bug to a person.

## Context

Agents write only test files and never change source code ([ADR 0002](0002-test-changed-units-and-write-only-tests.md)). The Backfill writes tests for code that already exists; changing that code is not its job. In the PR workflow, a person fixes a confirmed Defect and pushes ([ADR 0003](0003-derive-expectations-from-intent-and-review-defects.md)).

So a person always makes the fix, but today they get little help with it:
- A Defect is one row in the Report comment, among test results, coverage and mutation results.
- The Author has read the code and knows where it goes wrong, but that knowledge ends up only in its free-text summary, if at all.
- The Backfill's first run found behaviour that no Intent source states but that looks wrong. An example is the frontend overdue check, which uses the local date while the backend counter uses UTC. Such findings are not Defects under ADR 0003, so they were left as notes in the PR body, where they are easy to miss.

## Decision

1. Every found bug goes into one dedicated PR comment, the **Defects comment**. It is separate from the Report, Author and Reviewer comments. Both the PR workflow and the Backfill use it.
2. The comment lists two kinds of entries:
   - **Defects**, flagged, confirmed or rejected, with the state the Reviewer gave them. Confirmed ones come first.
   - **Suspected Defects**: behaviour that looks wrong but that no Intent source states. They are marked "needs owner decision" and never change the status.
3. Each entry contains:
   - a link to the file and line, pinned to the analyzed commit;
   - the Unit;
   - expected and received values, or for a Suspected Defect, what looks wrong and why;
   - the Intent source quote, if there is one;
   - a **suggested fix** as a `diff` block.
4. The Author writes the suggested fix as text in its structured output, as a diff against the file where it found the behaviour. Nothing applies it. The person who owns the PR applies it as it is, changes it, or writes their own fix, and pushes. The agents' write rules do not change: test files only.
5. The Reviewer checks every entry, including Suspected Defects and suggested fixes, and may add a note to each. A Suspected Defect stays one until an Intent source states the behaviour. Usually that is a PR description that says which behaviour is intended.
6. The comment is rendered by script from the agents' structured output, like the other comments, and sanitized the same way. In the PR workflow, `publish` upserts it. A run with no entries updates it to "no Defects on `<sha>`", so it never shows stale entries. For a Backfill PR, the same script renders it, and the person who opens the PR posts it.
7. The Report comment keeps its one-line status and the count of confirmed Defects, and links to the Defects comment.

## Consequences

- A person sees every bug in one place, with where it is and one way to fix it. The fix remains their decision and their commit.
- The suggested fix is model output. It can be wrong, and it can be steered by the PR body. It is shown as code only, never applied, and sanitized like other agent text.
- The PR gets four bot comments instead of three. AGENTS.md and SOLUTION.md describe four.
- `author.schema.json` gets the file line and the suggested fix for each Defect, plus a list of Suspected Defects. `reviewer.schema.json` gets a decision or note for each Suspected Defect. `agent-output.ts` checks that every entry names a Unit and a file that exist.
- A Suspected Defect needs judgement where no source exists, so the Author may report noise. The Reviewer's note and the "needs owner decision" label keep it from blocking anyone.

## Status

Proposed. Not built yet.
