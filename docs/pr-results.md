# Acting on a PR run

For the people who own a PR: how to read what the PR workflow posts, and what to do about it. How a run works is in [pr-run.md](pr-run.md).

## Reading the PR comments

Each comment has the title `### <name> · <outcome>`, where a script counts the outcome, then the analyzed commit and the run. What needs you comes first, then the tables; collapsed sections come last. 🟢 means passes, 🔴 fails or turns the status red, ⚠️ needs you but does not change the status.

- **Report** (`### 🟢 Report · <status>`): the status, each Defect the Author flagged with its test, expected and received values, Intent source, the Reviewer's decision and whether the Defect is proven, test results, coverage of changed files (per file: the changed lines the suite ran as `covered/total`, the uncovered changed line numbers as ranges, at most 10, and the whole file's line and branch %; only executable lines count, and it is information only), then skipped files and mutation results (information only), collapsed. The comment is updated in place on each push, so its last section, collapsed, lists up to 10 earlier runs, newest first: analyzed commit, status, run and date. Read it to see an earlier red result that a later green one replaced.
- **Test author**: what the Author tested. Each Unit has a Verdict, a kind (intent, characterization, or mixed with the number of tests of each), its tests and the number of attempts. Each Defect the Author flagged is one line, with expected and received values and its Intent source. A Unit marked `check-rejected` is not verified. Under the table, each such Unit has its reasons (it named something its file does not contain, a test name does not match its kind, a test is listed twice, a test file does not exist) and the test files that are in the Bot commit for it, or left out of it. Its tests are committed and ran, but count as no evidence: it is not in the "Units tested" count and gives no coverage claim. Only a test that overclaims intent has its file left out. Fix the names and re-run the workflow. It does not turn the status red. The Report shows the same list, before the test results. The Author's own summary is last, collapsed, and is not checked: trust the table.
- **Test reviewer**: the Reviewer's decision on each Defect, with its source quote, and its Findings. The Reviewer's own summary is last, collapsed.

On a PR that changes only tests and config, such as a Backfill PR, the agents have nothing to test, and the Test author and Test reviewer comments say so. A Backfill PR lists the Author and Reviewer results in its description. It has no changed source lines, so its Defects go in a fourth comment, **Defects**, with the same entries. See [ADR 0008](adr/0008-run-the-backfill-locally-and-report-it-in-the-pr-description.md).

Read the quotes and the Intent sources they cite. The agents can be wrong.

## When a Defect is reported

A confirmed and proven Defect means the code contradicts an Intent source and its test failed in the suites run. A confirmed Defect marked unproven is a warning: read the reason shown, and check the code yourself. Fix the source code, then push. The workflow's agents never change source code; they report Defects. The next PR run writes the test again.

A confirmed Defect with no test (the Report says the Author removed it) turns the status red too: the Reviewer confirmed the code contradicts an Intent source, but no test proves it. Check the code against the Reviewer's quote and fix it, or re-run the workflow with a dispatch (see [SOLUTION.md](../SOLUTION.md#how-to-run-the-pr-workflow)) to get the test.

If you think the Intent source is wrong, fix the source in the same PR and explain why in the PR description. Do not change a test to match the code.

A rejected Defect is only a warning. Read the Reviewer's quote, then decide.

A flaky test is a test the Bot commit added that failed in one of the `suites` job's shuffled reruns; it turns the status red. The Report names the file and the failing tests. Delete that test file or fix the test, then push.

A Suspected Defect is behaviour that looks wrong but that no Intent source states. Only a Backfill reports them for now, in its Defects comment. It never changes the status. Decide which behaviour is intended: fix the code, or state the current behaviour in the PR description.

## Re-running the workflow

See [SOLUTION.md](../SOLUTION.md#how-to-run-the-pr-workflow).

## The `skip-test-agent` label

Use it only as [ADR 0005](adr/0005-gate-merges-on-test-agent-verify.md) describes. Who may apply it is also set there. The suites still run and still gate the merge.

## Merging without the gate

Admins only, and only for the cases in [ADR 0005](adr/0005-gate-merges-on-test-agent-verify.md): a PR that changes the workflow's own scripts or paths, or an urgent fix while Actions or the model API is down. Split the change instead when you can. Comment on the PR with the reason and the checks you ran, then merge with `gh pr merge <n> --admin`.
