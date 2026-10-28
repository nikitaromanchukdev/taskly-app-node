---
name: prove-tests
description: Parts A and B. Run the new tests in the sandbox, fix the Author's own mistakes within the attempt budget, and report code that contradicts intent as a Defect.
---

# prove-tests

A test counts only after it has run green, or been reported as a Defect.

## Inputs
- The test files from `author-tests` and their Expectations.
- The attempt budget: env `TEST_AGENT_MAX_ATTEMPTS`, or the prompt. If neither gives one, ask the owner.

## Steps
1. Run the tests, only through the sandbox:
   `.github/scripts/sandbox.sh test <backend|frontend> <test file>`
   then `.github/scripts/sandbox.sh typecheck <backend|frontend>`.
   If the sandbox says dependencies are missing, stop and report it; do not work around it.
2. A run counts as one attempt for each Unit whose tests failed. Count attempts per Unit.
3. For each failure, decide whose mistake it is:
   - **Test is wrong** (bad import, wrong mock, typo, expected value not from the Intent source): fix the test and run again.
   - **Code contradicts the Expectation** (the test follows its Intent source and the code returns something else): this is a Defect. Do not change the Expectation to fit the code.
4. Stop retrying a Unit when it passes or its attempts reach the budget. A test still failing then is a Defect too.
5. For a Defect: delete only that failing test from the working tree, keep the Unit's passing tests, and record the Defect with the test name, expected, received and the Intent source. Verdict `flagged-defect`.
6. Run the whole new test file once more. It must pass with the Defect tests removed, and typecheck must pass.
7. Report each Unit's final Verdict, tests, Expectations, `kind` and `attempts`. Use the Verdict and reason values from `.github/scripts/author.schema.json`.

## Output
Green tests in the working tree, no failing test left behind, and the data for `author.json`.
