---
name: author-tests
description: PR workflow and Backfill. Write unit tests for each Unit's Expectations, following the repo's conventions for the package.
---

# author-tests

Turn Expectations into tests. Test files only.

## Inputs
- Units with Expectations and Intent sources from `extract-intent`.
- The playbook for the package: [backend.md](backend.md) or [frontend.md](frontend.md). Read it first.

## Steps
1. Pick the file: amend the existing test file for the Unit if there is one, else create one where the playbook says. Existing tests the change broke are fixed in `prove-tests`; a setup-only fix there also makes the Verdict `amended`.
2. Read the neighbouring tests and copy their style: imports, fixtures, naming, mocking.
3. Write one test per Expectation. Name it after the behaviour, not the function.
4. Assert on observable results: return values, responses, rendered output, calls on the collaborator. Never assert on private state.
5. Cover each boundary named in an Expectation with a test on both sides of it.
6. Take the expected value from the Expectation, not from running the code. A test that only repeats the implementation does not count.
7. Test one Unit per `describe` or `it` group. Keep tests independent; no shared mutable state, no real clock or network.
8. Edit only test files; the write hook blocks every other path.
9. Do not run the tests here. `prove-tests` does.

## Output
The test files in the working tree, and per Unit the Verdict (`added` or `amended`) and its Expectations, each with the tests that check it as `file > test name`. One test checks one Expectation.
