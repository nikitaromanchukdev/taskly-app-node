# Acting on a PR run

For the people who own a PR: how to read what the PR workflow posts, and what to do about it. How a run works is in [pr-run.md](pr-run.md).

## Reading the PR comments

Each comment has the title `### <name> · <outcome>`, where a script counts the outcome, then the analyzed commit and the run. What needs you comes first, then the tables; collapsed sections come last. 🟢 means passes, 🔴 fails or turns the status red, ⚠️ needs you but does not change the status.

- **Report** (`### 🟢 Report · <status>`): the status, each Defect the Author flagged with its test, expected and received values, Intent source and the Reviewer's decision, test results, coverage of changed files, then skipped files and mutation results (information only), collapsed.
- **Test author**: what the Author tested. Each Unit has a Verdict, a kind (intent, characterization, or mixed with the number of tests of each), its tests and the number of attempts. Each Defect the Author flagged is one line, with expected and received values and its Intent source. The Author's own summary is last, collapsed, and is not checked: trust the table.
- **Test reviewer**: the Reviewer's decision on each Defect, with its source quote, and its Findings. The Reviewer's own summary is last, collapsed.

On a PR that changes only tests and config, such as a Backfill PR, the agents have nothing to test, and the Test author and Test reviewer comments say so. A Backfill PR lists the Author and Reviewer results in its description. It has no changed source lines, so its Defects go in a fourth comment, **Defects**, with the same entries. See [ADR 0008](adr/0008-run-the-backfill-locally-and-report-it-in-the-pr-description.md).

Read the quotes and the Intent sources they cite. The agents can be wrong.

## When a Defect is reported

A confirmed Defect means the code contradicts an Intent source. Fix the source code, then push. The workflow's agents never change source code; they report Defects. The next PR run writes the test again.

If you think the Intent source is wrong, fix the source in the same PR and explain why in the PR description. Do not change a test to match the code.

A rejected Defect is only a warning. Read the Reviewer's quote, then decide.

A Suspected Defect is behaviour that looks wrong but that no Intent source states. Only a Backfill reports them for now, in its Defects comment. It never changes the status. Decide which behaviour is intended: fix the code, or state the current behaviour in the PR description.

## Re-running the workflow

See [SOLUTION.md](../SOLUTION.md#how-to-run-the-pr-workflow).

## The `skip-test-agent` label

Use it only as [ADR 0005](adr/0005-gate-merges-on-test-agent-verify.md) describes. Who may apply it is also set there. The suites still run and still gate the merge.

## Merging without the gate

Admins only, and only for the cases in [ADR 0005](adr/0005-gate-merges-on-test-agent-verify.md): a PR that changes the workflow's own scripts or paths, or an urgent fix while Actions or the model API is down. Split the change instead when you can. Comment on the PR with the reason and the checks you ran, then merge with `gh pr merge <n> --admin`.
