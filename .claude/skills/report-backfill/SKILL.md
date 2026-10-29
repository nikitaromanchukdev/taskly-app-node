---
name: report-backfill
description: Turn a finished local Backfill run (author.json, reviewer.json, coverage, Stryker) into the Backfill PR description and its Defects comment, and record the owner's decisions on Suspected Defects in SOLUTION.md. Use after the Author and Reviewer finish a Backfill for one package, or when the owner decides a Finding or Suspected Defect, e.g. "write the backfill PR", "report the backfill", "owner decided the suspected defects". Running the agents is not part of this skill; posting goes through github-ops.
allowed-tools:
  - Bash(node .github/scripts/agent-output.ts:*)
  - Bash(make report:*)
  - Bash(jq:*)
  - Read
  - Write
---

# Report Backfill

Write the Backfill PR description and the Defects comment from the run's artifacts, one package per PR (ADR 0008).

**The #1 rule:** copy Verdicts, kinds, Findings and Defect decisions from the rendered artifacts. Never count or retype them by hand. **Why:** no CI run checks a Backfill's results, so a hand-written number can drift from `author.json` and nobody would notice.

## Before Starting

| Input | Default | Notes |
|---|---|---|
| Package | ask | `backend` or `frontend`, never both in one PR |
| Artifacts dir | `.test-agent/backfill-{package}/` | `author.json`, `tests.patch`, `reviewer.json`; one subdir per Reviewer round |
| Approved gap list | `{dir}/approved-gaps.md` | from `map-coverage-gaps` and the owner's approval |
| Coverage before and after | `{dir}/coverage-before.json`, `{dir}/coverage-after.json` | `json-summary` reports |
| Attempt budget | the one the run used | for `agent-output.ts` |

---

## Step 1: Check the Agents' Output

```bash
node .github/scripts/agent-output.ts {dir}/author.json --patch {dir}/tests.patch \
  --reviewer {dir}/reviewer.json --max-attempts {budget} --out {dir}/checked.json
```

**Gate — stop here:** if the exit code is not 0 → report the errors to the owner. Do not write the PR description from output that fails the check.

---

## Step 2: Render the Tables

```bash
make report OUT={dir}
```

Read `{dir}/author.md` (Unit, Verdict, Kind, Tests, Attempts) and `{dir}/reviewer.md` (Defect decisions, Findings). The Kind column already has the form `intent`, `characterization`, `mixed ({n} intent, {m} characterization)`, or `—`.

---

## Step 3: Run Mutation on the Backfilled Files

In the package folder, with the backfilled source files as a comma-separated list:

```bash
npx stryker run --mutate "{file1},{file2}"
```

Read `reports/mutation/mutation.json`: the score, killed, survived, no coverage. For each surviving mutant, write why it is left alone: equivalent, unreachable, implementation detail, or no Intent source.

---

## Step 4: Write the PR Description

Write it to `{dir}/pr-body.md`. Section order:

| Section | Content |
|---|---|
| `## Summary` | One paragraph on how it ran, a `diff` file tree of the test files, then `### Approved items and Verdicts` (the Step 2 table), `### Unreachable`, `### Out of scope` |
| `## Evidence` | Coverage table per file: lines and branches before → after, a **Total** row; the per-file floors (level reached, rounded down); the Stryker score with the survivors in `<details>` |
| `### Reviewer` | Model, turns and cost per round; the Defect decisions; Findings as `Round \| Test \| Reason \| Note \| Owner decision` |
| `### Defects` | Counts, and a link to the Defects comment |
| `## Merge Danger` | Door, Blast Radius |
| Footer | `Part of #{n}`, then the Claude Code line |

---

## Step 5: Write the Defects Comment

One comment holds every Defect and Suspected Defect, confirmed Defects first (ADR 0007, 0008). Write it to `{dir}/defects.md`:

````markdown
<!-- pr-test-engineer:defects -->
### Defects

Analyzed: `{sha}` · Backfill, {package} · format from [ADR 0007]({link})

**Confirmed Defects:** {n, or "none"}.

**Suspected Defects:** {n}, {decision status}. Nothing below is applied.

---

#### {i}. {what looks wrong, one line} · {owner decision, or "needs owner decision"}

- **Owner decision:** {decision}. {reason}
- **Where:** [`{path}#L{a}-L{b}`]({permalink at the analyzed sha})
- **Unit:** `{Unit}`
- **What looks wrong:** {behaviour, and why it looks wrong}
- **Intent source:** {quote, or "none states it"}
- **Test:** {the test that records today's behaviour, if any}

```diff
{suggested fix}
```
````

Pin each **Where** link to the analyzed commit SHA, not `main`. **Why:** a line number on `main` moves with the next change.

---

## Step 6: Record the Owner's Decisions

When the owner decides a Finding or a Suspected Defect:

1. **Finding** - fill its **Owner decision** cell in the PR description, e.g., "Fixed: …", "Disputed: …".
2. **Suspected Defect** - add the decision to its heading and its **Owner decision** line in the Defects comment.
3. **SOLUTION.md** - add a row to the decision table under `## Backfill run`: `Suspected Defect | Owner decision`, with the reason in one sentence.

---

## Step 7: Publish

Hand `{dir}/pr-body.md` and `{dir}/defects.md` to the `github-ops` skill: it previews them, gets the owner's confirmation, and posts.

---

## Checklist

- [ ] `agent-output.ts` exit 0 on the final round
- [ ] Verdict and Kind copied from `author.md`, Findings from `reviewer.md`
- [ ] Every surviving mutant has a reason
- [ ] Every **Where** link is pinned to the analyzed SHA
- [ ] Every Finding and Suspected Defect has an owner decision before the merge
