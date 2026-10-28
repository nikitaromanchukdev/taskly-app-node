---
name: scope-change
description: Part B. Turn the Scope of a PR run into the list of changed Units, each with the existing tests that touch it.
---

# scope-change

Decide which Units this PR run must look at. Do not write tests here.

## Inputs
- `scope.json`: `candidates` (path, package, status, changed line ranges) and `skipped` files with a reason. Rules live in `.github/scripts/rules.ts`.

## Steps
1. Read `scope.json`. Ignore `skipped`; never second-guess a skip reason.
2. For each candidate, read the changed line ranges with `git diff <base>...<head> -- <path>` (base and head are in `scope.json`).
3. Map each hunk to the Unit it sits in: exported function, React component, hook or Express route. A hunk outside any Unit (imports, constants) belongs to the Units that use it.
4. Drop Units whose change cannot alter behaviour (rename of a local, comment, formatting). Keep them in the list with the reason `no-logic` so the report shows them.
5. For each remaining Unit, find existing tests that touch it:
   - backend: `grep` `backend/tests/` for the module name and exported names.
   - frontend: the co-located `<Name>.test.tsx` or `.test.ts`, plus tests that render it.
6. Note for each Unit whether the change is new code, changed behaviour, or a removal.

## Output
A working list, one row per Unit: path, Unit name, change type, existing tests (file > test name), proposed reason if no test is needed. Pass it to `extract-intent`.
