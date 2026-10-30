---
name: prove-tests
description: Run the new tests and each Unit's existing tests in the sandbox, fix the Author's own mistakes within the attempt budget, update existing tests the change broke, and report code that contradicts intent as a Defect. Use after author-tests, in both the PR workflow and the Backfill, to finish with green tests and the data for author.json.
---

# Prove Tests

Run every new and affected test until it is green or reported as a Defect.

**The #1 rule:** a test counts only after it has run green, or been reported as a Defect. Never change an Expectation to fit the code. **Why:** a test bent to match the code hides the Defect it found.

## Before Starting

| Input | Where it comes from | Notes |
|---|---|---|
| New test files and their Expectations | `author-tests` | |
| Existing tests of each Unit | `scope-change` | |
| Attempt budget | env `TEST_AGENT_MAX_ATTEMPTS`, or the prompt | Never default. If neither gives one, stop and report "Missing attempt budget" in `summary` with no Units; do not ask |

---

## Step 1: Run in the Sandbox

Run the new test files and the existing test files of each Unit, only through the sandbox:

```bash
.github/scripts/agent/sandbox.sh test {backend|frontend} {test files}
.github/scripts/agent/sandbox.sh typecheck {backend|frontend}
```

Once the new tests are green, run the new test files twice more with shuffled order: `.github/scripts/agent/sandbox.sh test {backend|frontend} --sequence.shuffle {new test files}`. A test that fails in one of those runs is flaky: fix it (shared state, time, randomness) before it counts as green. **Why:** the `suites` job reruns them shuffled and turns the status red on a flaky test.

**Gate — stop here:** if the sandbox says dependencies are missing → stop and report it. Do not work around it.

---

## Step 2: Count Attempts

A run counts as one attempt for each Unit whose tests failed. Count attempts per Unit.

---

## Step 3: Triage Failures in Tests You Wrote

| If | Then |
|---|---|
| **The test is wrong** (bad import, wrong mock, typo, expected value not from the Intent source) | Fix the test and run again |
| **The code contradicts the Expectation** (the test follows its Intent source and the code returns something else) | It is a Defect. Go to Step 6 |

---

## Step 4: Triage Failures in Existing Tests

For each failure or typecheck error in an existing test of a Unit, decide what the change did to it:

| If | Then |
|---|---|
| **Setup only** (a fake lacks a new method, a provider or mock is missing, a type changed) | Update the setup, leave every assertion as it is. Verdict `amended` |
| **Assertion, and an Intent source states the new behaviour** | Update the expected value and cite that source. Verdict `amended` |
| **Assertion, and no Intent source states the change** | A possible regression. Report a Defect with the test name, expected, received, and the test as its source. Leave it failing |
| **A test of no Unit in Scope** | Not yours. Do not touch it; mention it in `summary` |

NEVER delete or weaken an existing test. **Why:** it is the only record of the behaviour the change may have broken.

---

## Step 5: Stop Retrying

Stop retrying a Unit when it passes, or when its attempts reach the budget. A test still failing then is a Defect too.

---

## Step 6: Report a Defect in a Test You Wrote

1. **Record it** - the test name, expected, received, and the Intent source. Verdict `flagged-defect`.
2. **Keep the rest** - keep the Unit's passing tests.
3. **Isolate the failing test** in a new file of its own:

   **If it is already alone in a file you created:** leave the file as it is.

   **If it is anywhere else:** move the test with Write into a new file next to the original, named after the Unit and the Defect, then remove it from the original with Edit.

`bot_commit` drops a new file that holds a flagged Defect's test, so the failing test never reaches the Bot commit. Never delete or empty files; you have no tool for it.

---

## Step 7: Final Run

Run every test file you wrote or changed once more, except the files holding only a Defect's test.

It must pass, apart from existing tests left failing as Defects. Typecheck must show no error in those files.

---

## Step 8: Report

For each Unit, report its final Verdict and `attempts`, and each Expectation with its source, `kind`, and tests. Use the Verdict and reason values from `.github/scripts/contracts/author.schema.json`. A Unit with any Defect gets `flagged-defect`.

---

## Output Format

- Green tests in the working tree.
- No failing test left behind, except existing tests reported as Defects and the files holding only a Defect's test.
- The data for `author.json`.
