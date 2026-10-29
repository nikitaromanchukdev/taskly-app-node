---
name: author-tests
description: Write unit tests for each Unit's Expectations in the package's house style, using the backend or frontend playbook. Use after extract-intent and before prove-tests, in both the PR workflow and the Backfill. Writes test files only; running them is prove-tests' job.
---

# Author Tests

Turn each Expectation into a test, in test files only.

**The #1 rule:** take the expected value from the Expectation, not from running the code. A test that only repeats the implementation does not count. **Why:** such a test cannot fail when the Unit is wrong, so the Reviewer drops it as a tautology.

## Before Starting

| Input | Where it comes from | Notes |
|---|---|---|
| Units with Expectations and Intent sources | `extract-intent` | |
| Package playbook | this skill's folder | read it before Step 1, see the table below |

| Package | Read before Step 1 |
|---|---|
| `backend` | [backend.md](backend.md) |
| `frontend` | [frontend.md](frontend.md) |

---

## Step 1: Pick the File

**If the Unit has an existing test file:** amend it.

**If it has none:** create one where the playbook says.

Existing tests the change broke are fixed in `prove-tests`. A setup-only fix there also makes the Verdict `amended`.

---

## Step 2: Copy the Neighbouring Style

Read the neighbouring tests. Match their imports, fixtures, naming, and mocking.

---

## Step 3: Write the Tests

1. **One test per Expectation** - name it after the behaviour, not the function. One test checks one Expectation.
2. **Observable results only** - assert on return values, responses, rendered output, and calls on the collaborator. NEVER assert on private state. **Why:** a refactor that keeps the behaviour must not break the test.
3. **Boundaries** - for each boundary an Expectation names, test both sides of it.
4. **One Unit per group** - one Unit per `describe` or `it` group.
5. **Independent tests** - no shared mutable state, no real clock, no network.

---

## Step 4: Stop Before Running

Edit only test files. The write hook blocks every other path.

Do NOT run the tests here. `prove-tests` does.

---

## Output Format

The test files in the working tree, and per Unit:

```
{path} {Unit} | Verdict: {added / amended}
- {Expectation} | {kind} | {file > test name}
```

## Modules

| When | Read |
|---|---|
| Before Step 1, Unit in `backend/` | [backend.md](backend.md) |
| Before Step 1, Unit in `frontend/` | [frontend.md](frontend.md) |
