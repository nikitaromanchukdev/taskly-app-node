---
name: scope-change
description: Turn the Scope of a PR run (scope.json) into the list of changed Units, each with its change type and the existing tests that touch it. Use when a PR workflow run starts and the Author must decide which Units to look at. PR workflow only; a Backfill starts with map-coverage-gaps instead.
---

# Scope Change

Produce one row per changed Unit for `extract-intent`. Write no tests here.

**The #1 rule:** never second-guess a skip. `skipped` files are decided by `.github/scripts/contracts/rules.ts`. **Why:** the report already lists each skip with its reason, and a second opinion here would make the Scope differ from what the report shows.

## Before Starting

| Input | Where it comes from | Notes |
|---|---|---|
| `scope.json` | named in the prompt | `candidates` (path, package, status, changed line ranges), `skipped` (path, reason), `base`, `head` |

---

## Step 1: Read the Scope

Read `scope.json`. Use only `candidates`. Ignore `skipped`.

---

## Step 2: Read Each Changed Hunk

For each candidate, take `base` and `head` from `scope.json`:

```bash
git diff {base}...{head} -- {path}
```

---

## Step 3: Map Hunks to Units

1. **Find the enclosing Unit** - exported function, React component, hook, or Express route.
2. **Hunk outside any Unit** (imports, constants) - it belongs to the Units that use it.
3. **Change that cannot alter behaviour** (rename of a local, comment, formatting) - keep the Unit in the list with the reason `no-logic`, so the report shows it.

---

## Step 4: Find Existing Tests

For each Unit not marked `no-logic`:

| Package | Where to look |
|---|---|
| `backend` | `grep` `backend/tests/` for the module name and the exported names |
| `frontend` | the co-located `{Name}.test.tsx` or `{Name}.test.ts`, plus tests that render the Unit |

---

## Step 5: Name the Change Type

For each Unit, record one of: **new code**, **changed behaviour**, **removal**.

---

## Output Format

A working list, one row per Unit. Pass it to `extract-intent`.

```
{path} | {Unit} | {new code / changed behaviour / removal} | {file > test name, ...} | {proposed reason if no test is needed}
```
