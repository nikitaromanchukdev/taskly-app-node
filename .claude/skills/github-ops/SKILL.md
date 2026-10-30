---
name: github-ops
description: Read and write this repo's GitHub records with the gh CLI - open or edit a PR, comment, close or tick an issue, read the PR workflow's bot comments and the test-agent/verify status, re-run the workflow, apply the skip-test-agent label. Use when the task touches an issue, PR, comment, status, label, or workflow run, e.g. "open the PR", "update the PR description", "close the issue", "what did the bot say", "rerun the workflow". For the commit and push before a PR, use ship-change.
allowed-tools:
  - Bash(gh pr view:*)
  - Bash(gh pr diff:*)
  - Bash(gh pr checks:*)
  - Bash(gh pr list:*)
  - Bash(gh issue view:*)
  - Bash(gh issue list:*)
  - Bash(gh run list:*)
  - Bash(gh run view:*)
  - Read
---

# GitHub Ops

Read and write issues, PRs, comments, statuses and workflow runs of this repo through `gh`, the conventions included.

**The #1 rule:** every write is outward-facing. Preview it, get the owner's confirmation, then write. **Why:** other people see it at once, and GitHub may notify, cache, or index it even if it is deleted later.

## Before Starting

| Input | Default | Notes |
|---|---|---|
| Repo | derived: `gh` reads it from `git remote` | `nikitaromanchukdev/taskly-app-node` |
| Issue or PR number | from the task, or the branch name `feat/issue-{n}-{slug}` | Never default a number for a write. Ask |
| Auth | `gh auth status` | If not logged in, tell the owner to run `! gh auth login`. Never log in for them |

GitHub MCP is NOT used. **Why:** `gh` is already logged in and every script uses it; an MCP server would need a personal access token with broad scopes stored in config, which adds a secret and no capability.

---

## Step 1: Check the Target

**Gate — stop here:** if the PR is from a fork (`gh pr view {n} --json isCrossRepository --jq .isCrossRepository` is `true`) → do not write to it. **Why:** the PR workflow never acts on fork PRs (ADR 0004), and contributors follow the same rule.

| Never do | Why |
|---|---|
| Merge a PR | The owner merges |
| Edit the Report, Test author, or Test reviewer comment | `publish` owns them (markers `<!-- pr-test-engineer:report -->`, `:author`, `:reviewer`) and overwrites them on the next PR run |
| Add `skip-test-agent` without the owner asking | Only for the cases in ADR 0005; who may apply it is set there |

---

## Step 2: Build the Payload

Write every multi-line body to a file in the scratchpad, never inline. **Why:** backticks and `$` in an inline body are expanded by the shell.

**PR title:** Conventional Commits with a scope, e.g., `fix(scripts): link the ADR behind every reason an agent did not run`.

**PR body:**

````markdown
## Summary

{what changes and why, with the smallest diagram, diff sketch, or file tree that makes it clear}

## Intended behaviour

- {one line per behaviour: "when X, then Y"; or "None: {why}" for a change with no behaviour}

## Evidence

| Check | Result |
|---|---|
| {command} | 🟢 pass ({n} passed) |

- **Before:** {output, failing test}
  **After:** {output, passing test}

## Merge Danger

**Door:** {one-way / two-way}

**Blast Radius:** {one word}

{Closes #n / Part of #n}

🤖 Generated with [Claude Code](https://claude.com/claude-code)
````

- **`Closes #{n}`** - the PR finishes the issue. **`Part of #{n}`** - it does not.
- **Intended behaviour** - the PR workflow reads the description as an Intent source, so state what the code should do in its own section.
- **Same format as the bot comments** - H2 sections, H3 subsections. Emoji only 🟢 pass, 🔴 fail, ⚠️ needs a person but does not change the status. Name a Unit as `` `{path}` {Unit} ``. Long lists go last, in `<details><summary>{Name} ({count})</summary>`.
- **Tooling PRs** - a PR that changes `.claude/` or `.github/scripts/` runs with `main`'s copy in its own PR run. Say so in Evidence.

---

## Step 3: Preview and Confirm

Print the exact title and body, or the comment, then ask:

```
Use AskUserQuestion with:
- question: "Write this to GitHub?"
- header: "Confirm"
- options:
  1. "Write" - post as previewed
  2. "Edit" - change it first
```

**If "Edit"** → apply the change, preview again. **If the owner cancels** → say nothing was written.

The owner's yes covers this one write only. **Why:** approval in one context does not carry to the next.

---

## Step 4: Write

| Task | Command |
|---|---|
| Open a PR | `gh pr create --base main --title "{title}" --body-file {file}` |
| Replace a PR description | `gh pr edit {n} --body-file {file}` |
| Comment on a PR or issue | `gh pr comment {n} --body-file {file}` / `gh issue comment {n} --body-file {file}` |
| Edit an existing comment | `gh api -X PATCH repos/{owner}/{repo}/issues/comments/{id} -F body=@{file}` |
| Tick a task in an issue | `gh issue view {n} --json body --jq .body > {file}`, change `- [ ]` to `- [x]`, then `gh issue edit {n} --body-file {file}` |
| Close an issue | `gh issue close {n} --comment "{why, with the PR link}"` |
| Re-run the PR workflow | `gh workflow run pr-test-engineer.yml -f pull-request={n}` |
| Apply the label | `gh pr edit {n} --add-label skip-test-agent` |

**If a write is blocked by the permission mode:** do not retry it another way. Write the commands to a script in the scratchpad that ends with `rm -- "$0"`, give its full path, and ask the owner to run `! sh {path}`. **Why:** the owner can't copy long commands from the terminal, and the script removes itself after one run.

---

## Step 5: Read Results

| Read | Command |
|---|---|
| Bot comments | `gh pr view {n} --json comments --jq '.comments[] \| select(.author.login=="github-actions") \| .body'` |
| `test-agent/verify` | `gh pr checks {n}` |
| A run's log | `gh run view {run id} --log-failed` |
| Comment ids | `gh api repos/{owner}/{repo}/issues/{n}/comments --jq '.[] \| {id, user: .user.login, start: .body[0:60]}'` |

- **One number space** - issues and PRs share numbers. If `gh pr view {n}` fails, try `gh issue view {n}`.
- **Approve-run prompt** - if GitHub asks to approve a run after a Bot commit, approving or not changes nothing: that run skips every job.
- **The status sits on the last commit** - after a Bot commit, `test-agent/verify` is on the Bot commit, not on your push.

---

## Done

End with the link to what was written: the PR, the comment, or the run.
