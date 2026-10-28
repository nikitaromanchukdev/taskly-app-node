# ADR 0001: Use Claude Code through claude-code-action as the agent runtime

For reviewers and future maintainers: why the agents run in Claude Code and not in custom code.

## Context

The PR test workflow needs an agent that reads the repo, edits test files, runs commands and returns structured output. The same agent must run in GitHub Actions and on a developer machine, so that a local trial shows what CI will do.

A custom tool loop around the model API would need its own permission rules, hooks and structured output. These are the parts most likely to fail quietly, so they come from a tool that already has them.

## Decision

- Each agent is a Claude Code agent file in `.claude/agents/`: the Author (`pr-test-engineer.md`) and the Reviewer (`pr-test-reviewer.md`).
- CI runs each agent with `anthropics/claude-code-action`, pinned to a commit SHA. The workflow passes the agent name, the model, the turn limit and a JSON schema for the output.
- Locally, `make trial` runs the same agent files with the `claude` CLI in print mode.
- Permissions and the write-guard hook live in `.claude/agent-settings.json`. Every agent run receives that file: `--settings` locally, the action's `settings` input in CI.
- Structured output comes back through a `StructuredOutput` tool, so both agent files list it. The scripts check the output again after the run.

## Consequences

- One set of agent files, skills and settings serves CI and local runs. A local trial is a fair preview of the agent part of CI.
- The workflow depends on the action's inputs and on CLI flags (`--agent`, `--json-schema`, `--settings`). A new version can change behaviour, so the action is pinned to a commit.
- The agent loop is upstream code. A bug in it can only be worked around in the scripts.
- The settings file binds agent runs only. Contributors' own Claude Code sessions are not bound by it. See [ADR 0004](0004-isolate-pr-code-from-secrets.md).
- Every agent run uses a paid model key, so the budgets in [ADR 0006](0006-set-budgets-as-admin-only-repo-variables.md) apply to all of them.

## Status

Accepted.
