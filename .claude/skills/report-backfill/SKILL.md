---
name: report-backfill
description: Turn a finished local Backfill run (make backfill-tests output: author.json, reviewer.json, coverage; plus Stryker) into the Backfill PR description and its Defects comment, and record the owner's decisions on Suspected Defects in SOLUTION.md and the decided gaps in docs/backfill-decisions.json. Use after the Author and Reviewer finish a Backfill for one package, or when the owner decides a Finding or Suspected Defect, e.g. "write the backfill PR", "report the backfill", "owner decided the suspected defects". Running the agents is run-local-workflow's job; posting goes through github-ops.
allowed-tools:
  - Bash(node .github/scripts/workflow/agent-output.ts:*)
  - Bash(make report:*)
  - Bash(make backfill-record:*)
  - Bash(node .github/scripts/local/trial.ts decide:*)
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
| Artifacts dir | the branch's folder: `node .github/scripts/local/trial.ts dir` | written by `make backfill-gaps` and `make backfill-tests` (the `run-local-workflow` skill runs them) |
| Approved gap list | `{dir}/approved.json`, rendered in `{dir}/gaps.md` | the owner's choice from `make backfill-approve` |
| Declined gaps | `{dir}/declined.json` | Recommendations the owner declined, each with a reason |
| Decided earlier | the **Decided earlier** section of `{dir}/gaps.md` | gaps left out because an earlier Backfill decided them |
| Coverage before and after | `{dir}/coverage-before.json`, `{dir}/coverage-after.json` | `json-summary` reports from `make backfill-tests` |
| Attempt budget | the one the run used | for `agent-output.ts` |

---

## Step 1: Check the Agents' Output

`make backfill-tests` already wrote `{dir}/checked.json`. Run the check again only after the owner edited tests by hand (a new Reviewer round):

```bash
node .github/scripts/workflow/agent-output.ts {dir}/author.json --patch {dir}/tests.patch \
  --reviewer {dir}/reviewer.json --max-attempts {budget} --out {dir}/checked.json
```

**Gate — stop here:** if the exit code is not 0 → report the errors to the owner. Do not write the PR description from output that fails the check.

---

## Step 2: Render the Tables

`make backfill-tests` already rendered them. After a new Reviewer round, render them again:

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

Write it to `{dir}/pr-body.md`. One H2 per bot comment, with that comment's tables, so the description reads like the PR run it replaces. Section order:

| Section | Content |
|---|---|
| `## Summary` | One paragraph on how it ran, a `diff` file tree of the test files |
| `## Test author` | The title's outcome line and the Units table from `author.md`, as rendered (`Unit \| Verdict \| Kind \| Tests \| Attempts`); then `### Declined` (from `declined.json`, with each reason), `### Unreachable`, `### Out of scope`, `### Decided earlier` (copied from `gaps.md`) |
| `## Test reviewer` | Model, turns and cost per round; `### Defect decisions` and `### Findings` as in `reviewer.md`, with `Round` added on the left and `Owner decision` on the right |
| `## Defects` | The Defects comment's outcome line, and a link to it |
| `## Evidence` | `### Coverage`: `File \| Lines % \| Branches %`, each `before → after`, a **Total** row, then the per-file floors (level reached, rounded down). `### Mutation`: the Stryker score, the survivors in `<details><summary>Surviving mutants ({n})</summary>` |
| `## Merge Danger` | Door, Blast Radius |
| Footer | `Part of #{n}`, then the Claude Code line |

Add columns only on the right of a copied table, never rename or reorder them. **Why:** the reader compares the description with the bot comments of PR runs.

---

## Step 5: Write the Defects Comment

One comment holds every Defect and Suspected Defect, confirmed Defects first (ADR 0007, 0008). Write it to `{dir}/defects.md`:

````markdown
<!-- pr-test-engineer:defects -->
### Defects · {n} confirmed, {m} Suspected
Analyzed `{sha7}` · Backfill, {package} · [ADR 0007]({link})

Nothing below is applied. Each entry has a suggested fix and an owner decision.

#### 🔴 Defect {i} · confirmed · `{path}` {Unit}

{what the code gets wrong, one sentence}

- **Where:** [`{path}#L{a}-L{b}`]({permalink at the analyzed sha})
- **Expected:** {value} · **Received:** {value}
- **Intent source:** "{quote}"
- **Reviewer:** {decision and quote}
- **Owner decision:** {decision}. {reason}

```diff
{suggested fix}
```

#### ⚠️ Suspected Defect {i} · {owner decision, or "needs owner decision"} · `{path}` {Unit}

{what looks wrong, one sentence}

- **Where:** [`{path}#L{a}-L{b}`]({permalink at the analyzed sha})
- **What looks wrong:** {behaviour, and why it looks wrong}
- **Intent source:** none states it. {the nearest source, quoted, if any}
- **Test:** {the test that records today's behaviour, if any}
- **Owner decision:** {decision}. {reason}

```diff
{suggested fix}
```
````

Same shape as the bot comments: one H3 title with the counts, the meta line, one H4 per entry, confirmed Defects first, no `---` rules. With no confirmed Defects, write `No confirmed Defects.` above the first entry. The emoji mean what they mean in the bot comments: 🔴 turns the status red, ⚠️ needs a person but does not.

Pin each **Where** link to the analyzed commit SHA, not `main`. **Why:** a line number on `main` moves with the next change.

---

## Step 6: Record the Owner's Decisions

When the owner decides a Finding or a Suspected Defect:

1. **Finding** - fill its **Owner decision** cell in the PR description, e.g., "Fixed: …", "Disputed: …".
2. **Suspected Defect** - put the decision in its heading, in place of "needs owner decision", and on its **Owner decision** line in the Defects comment.
3. **SOLUTION.md** - add a row to the decision table under `## Backfill run`: `Suspected Defect | Owner decision`, with the reason in one sentence.
4. **Kept as is** - when the owner keeps a Suspected Defect's behaviour, record it, so later Backfills skip that gap. `{pr}` is the PR where the owner decided:

   ```bash
   node .github/scripts/local/trial.ts decide --package {package} --path {path} --unit {Unit} --lines {a-b} \
     --decision kept-as-is --reason "{what looks wrong}. {owner's reason}" --pr {pr}
   ```

---

## Step 7: Publish

Hand `{dir}/pr-body.md` and `{dir}/defects.md` to the `github-ops` skill: it previews them, gets the owner's confirmation, and posts.

---

## Step 8: Record the Decided Gaps

Once the PR has a number, add this Backfill's declined Recommendations and not-needed Units to `docs/backfill-decisions.json`:

```bash
make backfill-record PACKAGE={package} PR={n}
```

The change goes in the same Backfill PR; commit it through the `ship-change` skill. **Why:** the next `make backfill-gaps` leaves these gaps out only once the record is on the base branch (ADR 0008).

---

## Checklist

- [ ] `agent-output.ts` exit 0 on the final round
- [ ] Units table copied from `author.md`, Defect decisions and Findings from `reviewer.md`, columns unchanged
- [ ] Every surviving mutant has a reason
- [ ] Every **Where** link is pinned to the analyzed SHA
- [ ] Every Finding and Suspected Defect has an owner decision before the merge
- [ ] `docs/backfill-decisions.json` holds this PR's declines, not-needed Units and kept Suspected Defects
