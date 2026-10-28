# ADR 0006: Set budgets as admin-only repo variables

For reviewers and maintainers: why the model, turn, timeout and attempt budgets are repo variables with no defaults, and what caps the cost.

## Context

A model-driven run costs money and time. A run with no limit has no cap. A default written into the workflow would be a silent choice that nobody reviews. Budgets must be changed by an admin, not by a pull request.

## Decision

- Five repo variables hold the budgets: the Author's model, the Reviewer's model, the turn limit per agent step, the timeout per agent step, and the attempt limit per Unit. Their names are listed in [SOLUTION.md](../../SOLUTION.md), under prerequisites.
- CI has no defaults. The first job, `prepare`, checks all five before any agent runs. A missing or invalid value fails the run, with a message that names the variable. The validation rules are in `.github/scripts/prepare.ts`.
- The turn limit and the timeout are enforced on each agent step. The attempt limit is passed to the Author as a soft limit, and the scripts check the Author's output against it again.
- The Makefile has its own local defaults, used only by `make trial`. They never reach CI.
- `scripts/setup-github.sh config` sets the variables. Admins edit them afterwards.
- The monthly spend limit is set in the model provider's console. It is the hard cap on money. The repo variables cap each run; the console caps the month.

## Consequences

- A new clone fails in `prepare` until the variables are set. This is intended.
- The budgets are the same for every PR. Normal files in a PR do not change them. The workflow file does, and a same-repo writer can edit it. See the limitations in [SOLUTION.md](../../SOLUTION.md).
- The spend limit is the only cap that holds if the workflow file is edited. Keep it set.

## Status

Accepted.
