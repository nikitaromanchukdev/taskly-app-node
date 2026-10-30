# ADR 0010: Reject one Unit, not the whole run, for a slip in its own output

For reviewers and future maintainers: what `agent-output.ts` does when the Author's output breaks a rule, and why the answer depends on what the rule protects.

Amended after demo run 41061277234: a check-rejected Unit's tests now stay in the Bot commit, except a test that overclaims intent.

## Context

`bot_commit` runs `agent-output.ts` on the Author's and the Reviewer's output before anything reaches the PR. Until this decision, any error made the whole output invalid: no Bot commit, no Defect proof, and the status red as "agent output invalid or patch rejected" or "Bot commit job failed".

The models do not write the same output twice. In the live runs, single slips in one Unit's entry cost whole runs:

- a Defect test named by its `describe` block instead of its file path (PR #60, run 41046325172);
- a Unit named `GET /due-soon route`, where "route" is not in `router.ts`, and a characterization test without its `characterization: ` prefix (PR #70, run 41056516386).

In both runs the Author had flagged a real Defect and the Reviewer had confirmed it. The slip hid it. Fixing each rule as it failed did not help: the next run broke a different one. A schema `pattern` now enforces the test-ID format while the Author runs (PR #65), and the shape of a Unit name: an identifier, a dotted identifier, or a route as `METHOD /path` with nothing after it. Rules that compare the output with the code, such as whether the name is in the file, cannot be written in a schema.

The first version of this decision also dropped the test files of a check-rejected Unit. In demo run 41061277234 (PR #70) the Author named a route Unit `GET /due-soon route`. The Unit was check-rejected and its route tests were dropped, there was no Bot commit, `router.ts` fell under its coverage floor, and the status said only "suites job failed". The checks catch slips in how the Author labelled its output. They do not show that a test is invalid: the sandbox run, the write guard, the Reviewer's blocking Findings and the Defect proof do that.

## Decision

1. `agent-output.ts` sorts its checks by what they protect.
   - **Run-level**, the output as a whole cannot be trusted: schema errors in either output, the same Unit listed twice, a Unit without its required fields, attempts over the budget ([ADR 0006](0006-set-budgets-as-admin-only-repo-variables.md)), a missing Reviewer output, Reviewer decisions or Findings on unknown Units or tests, a flagged Defect without a decision, a Defect test left in an existing file, and anything the write guard rejects. These still make the output invalid.
   - **Unit-level**, one Unit's own content is wrong: an identifier of its name that is not in its file, a test whose name does not match its Expectation's kind, a test listed under two Expectations, a test file that is in neither the checkout nor the patch. These make that Unit **check-rejected**.
2. A check-rejected Unit is **not verified**: its tests stay in the Bot commit and count as no evidence. They are not in the "N units tested" count and make no coverage claim. The Report and the Test author comment say which test files belong to not-verified Units, with each reason. One exception: a test that overclaims intent, meaning a test named without `characterization: ` under an Expectation of kind `characterization`, would state in the file an intent that no source states. Its file is left out of the Bot commit, as for a blocking Finding ([ADR 0003](0003-derive-expectations-from-intent-and-review-defects.md)), and another Unit with tests in that file is check-rejected too. The other direction, a `characterization: ` name under an `intent` Expectation, understates the test: it is kept and only reported.
3. The Defect path does not depend on it. A check-rejected Unit's Defect test is kept out of the Bot commit and proven as any other ([ADR 0005](0005-gate-merges-on-test-agent-verify.md)). If its test cannot be found, the confirmed Defect is red as a Defect without a test.
4. Check-rejected Units alone do not change the status. When the `suites` job fails with green tests because a package missed its coverage floor, the status names the floor, and says when there was no Bot commit or the Bot commit left out the tests of some Units. `verify.sh` records vitest's exit code, and `results.ts` reads it only when every test of the package passed. Names and reasons go in the Report, not the status.
5. `make demo` stays strict: a check-rejected Unit in a case is a FAIL ([ADR 0009](0009-test-agent-config-changes-against-committed-cases.md)).

## Consequences

- A slip in one Unit costs the trust in that Unit, not its tests and not the run. The other Units are committed, and a confirmed Defect still reaches the status.
- The Bot's own mistake does not block the developer, and does not lower coverage. The Report shows which tests belong to not-verified Units and why.
- A test that overclaims intent still costs its file, and the Units in it. Splitting a patch by test is not reliable; the same trade-off is accepted for blocking Findings.
- A coverage floor missed because of a left-out or absent Bot commit is named in the status instead of "suites job failed".
- The line between run-level and Unit-level is a judgement per check. A new check must be placed in one class, with the reason, in `agent-output.ts`.
- The rules still bind the agent config: a PR that changes it must pass `make demo`, where no slip is tolerated.

## Status

Accepted.
