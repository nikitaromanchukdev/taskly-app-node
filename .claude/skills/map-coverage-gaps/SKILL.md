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

Read `{package}/coverage/report/lcov.info` (the sandbox writes coverage there). Per file, collect:

| Gap | lcov line |
|---|---|
| Uncovered line | `DA:{line},0` |
| Uncovered branch | `BRDA` ending in `0` or `-` |
| Uncovered function | `FNDA:0,{name}`, at the line of its `FN` |

Keep the line number of every gap.

---

## Step 3: Group by Unit

Group the gaps by Unit. Every logic file under 100% appears exactly once in the report.

---

## Step 4: Classify Each File

| If | Then |
|---|---|
| It matches a skip rule in `.github/scripts/contracts/rules.ts`, or a path in `ignored-paths.json` there (reason id `ignored`) | **Out of scope**, with the rule's reason id |
| No clean way to exercise it from a unit test (e.g., process startup) | **Unreachable**, with why |
| Anything else | **Recommendation** |

---

## Step 5: Write and Rank Recommendations

1. **Expectations** - write each gap as an Expectation ("when X, then Y") with its Intent source.
2. **Coverage now** - record the current lines and branches percent per Unit, and the line numbers of its gaps (Step 2) as `uncovered`. `make backfill-gaps` then checks them against `lcov.info`: it drops a line that is covered and adds the ones you left out between your first and last line.
3. **Rank** - in this order:
   1. failure paths a user sees
   2. branches that choose an outcome
   3. happy paths of untested Units

---

## Step 6: Stop for Approval

End the run with the report as the structured output. Write no tests.

**Gate — stop here:** write no tests until the owner names the approved items. Only those go on to `extract-intent`. An approved item that still cannot be exercised gets the Verdict `not-needed` with the reason `unreachable`.

`make backfill-gaps` renders the report as `gaps.md` and asks the owner. The approved list comes back as `approved.json` in the same shape, for the next run.

Report every gap in the lists, including ones an earlier Backfill decided. `trial.ts approve` leaves out each gap whose uncovered lines are all recorded in `docs/backfill-decisions.json` for an unchanged file, and lists it under **Decided earlier**. **Why:** a script matches the record the same way every time, and a changed file brings its gap back for a new decision (ADR 0008).

Read `docs/backfill-decisions.json` before you write the `summary`. Describe only the gaps whose lines it does not record, and say how many it does. **Why:** the owner reads the summary above lists that no longer hold the decided gaps; a summary naming them reads as open work.

---

## Output Format

The structured output required by `.github/scripts/contracts/gaps.schema.json`:

| Field | Holds |
|---|---|
| `summary` | short markdown: what was measured and the biggest gaps not yet decided (Step 6) |
| `recommendations` | ranked as in Step 5; each with `path` from the repo root, `unit` as the bare name (no notes such as "(failure path)"), `lines` and `branches` as percent strings (e.g., `"61.25"`), `uncovered` as the gap's line numbers (e.g., `"18, 20-22"`), and `expectations` (`text`, `source`, `kind`) |
| `unreachable` | `path`, `unit`, `uncovered` as for a Recommendation, and the `reason` no unit test can exercise it |
| `out_of_scope` | `path`, and the skip rule's `reason` id from `rules.ts` |
