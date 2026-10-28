---
name: map-coverage-gaps
description: Backfill only. Rank the untested behaviour of the whole codebase and stop for the owner's approval before any test is written.
---

# map-coverage-gaps

Find what is worth testing across the repo. This skill writes no tests.

## Inputs
- A package, or both. The attempt budget is not needed yet.

## Steps
1. For each package run `.github/scripts/sandbox.sh test <package> --coverage --coverage.reportOnFailure`.
2. Read `<package>/coverage/lcov.info`. Collect uncovered lines (`DA:<line>,0`) and branches (`BRDA` with `0` or `-`) per file.
3. Group the gaps by Unit. Every logic file under 100% appears exactly once.
4. Classify each file:
   - **Out of scope**: it matches a skip rule in `.github/scripts/rules.ts`. Give the reason id.
   - **Unreachable**: no clean way to exercise it from a unit test (for example process startup). Say why.
   - **Recommendation**: everything else.
5. For each Recommendation, write the gaps as Expectations ("when X, then Y") with their Intent source. Order by: failure paths a user sees, then branches that choose an outcome, then happy paths of untested Units.
6. Record current lines and branches percent per Unit.

## Output
A report with three sections: Recommendations (Unit, coverage now, Expectations with Intent source), Unreachable, Out of scope.

Stop here. Show the report to the owner and wait. Only the items the owner approves go on to `extract-intent`. An approved item that still cannot be exercised gets the Verdict `not-needed` with reason `unreachable`.
