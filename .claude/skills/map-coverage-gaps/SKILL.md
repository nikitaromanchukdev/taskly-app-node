---
name: map-coverage-gaps
description: Rank the untested behaviour of the whole codebase from coverage reports into Recommendations, Unreachable, and Out of scope (gaps.schema.json), then stop for the owner's approval. Use when starting a Backfill, i.e. adding tests for existing untested code. Backfill only; a PR run starts with scope-change instead. Writes no tests.
---

# Map Coverage Gaps

Produce a ranked report of what is worth testing across the repo, then stop.

**The #1 rule:** STOP after the report and wait for the owner. **Why:** the owner decides what the Backfill tests; only approved items go on to `extract-intent`.

## Before Starting

| Input | Default | Notes |
|---|---|---|
| Package | both | `backend`, `frontend`, or both |

The attempt budget is not needed yet.

---

## Step 1: Run Coverage

For each package:

```bash
.github/scripts/agent/sandbox.sh test {package} --coverage --coverage.reportOnFailure
```

---

## Step 2: Read the Gaps

Read `{package}/coverage/lcov.info`. Per file, collect:

| Gap | lcov line |
|---|---|
| Uncovered line | `DA:{line},0` |
| Uncovered branch | `BRDA` ending in `0` or `-` |

---

## Step 3: Group by Unit

Group the gaps by Unit. Every logic file under 100% appears exactly once in the report.

---

## Step 4: Classify Each File

| If | Then |
|---|---|
| It matches a skip rule in `.github/scripts/contracts/rules.ts` | **Out of scope**, with the rule's reason id |
| No clean way to exercise it from a unit test (e.g., process startup) | **Unreachable**, with why |
| Anything else | **Recommendation** |

---

## Step 5: Write and Rank Recommendations

1. **Expectations** - write each gap as an Expectation ("when X, then Y") with its Intent source.
2. **Coverage now** - record the current lines and branches percent per Unit.
3. **Rank** - in this order:
   1. failure paths a user sees
   2. branches that choose an outcome
   3. happy paths of untested Units

---

## Step 6: Stop for Approval

End the run with the report as the structured output. Write no tests.

**Gate — stop here:** write no tests until the owner names the approved items. Only those go on to `extract-intent`. An approved item that still cannot be exercised gets the Verdict `not-needed` with the reason `unreachable`.

`make backfill-gaps` renders the report as `gaps.md` and asks the owner. The approved list comes back as `approved.json` in the same shape, for the next run.

---

## Output Format

The structured output required by `.github/scripts/contracts/gaps.schema.json`:

| Field | Holds |
|---|---|
| `summary` | short markdown: what was measured and the biggest gaps |
| `recommendations` | ranked as in Step 5; each with `path`, `unit`, `lines` and `branches` as percent strings (e.g., `"61.25"`), and `expectations` (`text`, `source`, `kind`) |
| `unreachable` | `path`, `unit`, and the `reason` no unit test can exercise it |
| `out_of_scope` | `path`, and the skip rule's `reason` id from `rules.ts` |
