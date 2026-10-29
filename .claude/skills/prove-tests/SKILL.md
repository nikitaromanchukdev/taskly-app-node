---
name: prove-tests
description: PR workflow and Backfill. Run the new tests and the existing tests of each Unit in the sandbox, fix the Author's own mistakes within the attempt budget, update existing tests the change broke, and report code that contradicts intent as a Defect.
---

# prove-tests

A test counts only after it has run green, or been reported as a Defect.

## Inputs
- The test files from `author-tests` and their Expectations.
- The existing tests of each Unit, from `scope-change`.
- The attempt budget: env `TEST_AGENT_MAX_ATTEMPTS`, or the prompt. If neither gives one, ask the owner.

## Steps
1. Run the new test files and the existing test files of each Unit, only through the sandbox:
   `.github/scripts/sandbox.sh test <backend|frontend> <test files>`
   then `.github/scripts/sandbox.sh typecheck <backend|frontend>`.
   If the sandbox says dependencies are missing, stop and report it; do not work around it.
2. A run counts as one attempt for each Unit whose tests failed. Count attempts per Unit.
3. For each failure in a test you wrote, decide whose mistake it is:
   - **Test is wrong** (bad import, wrong mock, typo, expected value not from the Intent source): fix the test and run again.
   - **Code contradicts the Expectation** (the test follows its Intent source and the code returns something else): this is a Defect. Do not change the Expectation to fit the code.
4. For each failure or typecheck error in an existing test of a Unit, decide what the change did to it:
   - **Setup only** (a fake lacks a new method, a provider or mock is missing, a type changed): update the setup and leave every assertion as it is. Verdict `amended`.
   - **Assertion, and an Intent source states the new behaviour:** update the expected value and cite that source. Verdict `amended`.
   - **Assertion, and no Intent source states the change:** a possible regression. Report a Defect with the test name, expected, received and the test as its source. Never delete or weaken the existing test; leave it failing.
   - A failure in a test of no Unit in Scope is not yours. Do not touch it; mention it in `summary`.
5. Stop retrying a Unit when it passes or its attempts reach the budget. A test still failing then is a Defect too.
6. For a Defect in a test you wrote: record the Defect with the test name, expected, received and the Intent source. Verdict `flagged-defect`. Keep the Unit's passing tests. Then leave the failing test in a new file of its own:
   - Already alone in a file you created: leave the file as it is.
   - Anywhere else: move the test with Write into a new file next to the original, named after the Unit and the Defect, and remove it from the original with Edit.
   `commit` drops a new file that holds a flagged Defect's test, so the failing test never reaches the Bot commit. Never delete or empty files; you have no tool for it.
7. Run every test file you wrote or changed once more, except the files holding only a Defect's test. It must pass, apart from existing tests left failing as Defects. Typecheck must show no error in those files.
8. Report each Unit's final Verdict and `attempts`, and each Expectation with its source, `kind` and tests. Use the Verdict and reason values from `.github/scripts/author.schema.json`. A Unit with any Defect gets `flagged-defect`.

## Output
Green tests in the working tree, no failing test left behind except existing tests reported as Defects and the files holding only a Defect's test, and the data for `author.json`.
