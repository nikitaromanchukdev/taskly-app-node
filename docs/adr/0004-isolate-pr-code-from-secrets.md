# ADR 0004: Isolate PR code from secrets

For reviewers and future maintainers: why PR code never runs next to the model key, and why agent config comes from the base branch.

## Context

PR code is untrusted. Its npm install scripts, Vitest config and test files all run when tests run. On a host that holds the model key, that code could read the key and send it out.

PR text (title, body), and the agent summaries it can steer, are untrusted too. The agents treat it as data, and the report renders it in a safe form.

Fork PRs come from people outside the repo. They must not reach any secret.

## Decision

1. **Privilege split.** A job that holds a write token or the model key never runs PR code on the host. `agents` holds the model key and a read-only token, and runs PR code only inside containers. `bot_commit` and `publish` hold write tokens, run no model and no PR code, and use scripts from the base commit. `suites` runs PR code with a read-only token and no secrets.
2. **Base-branch config.** Before the agent runs, `agents` replaces the agent config and scripts with the base commit's versions: `.claude/`, `CLAUDE.md`, `AGENTS.md`, `.mcp.json` and `.github/scripts/`. It first removes every `.claude/`, `CLAUDE.md`, `CLAUDE.local.md` and `AGENTS.md` in the tree, because nested instruction files load too. The logic is `.github/scripts/agent/overlay.sh`, read from the base commit, not from the checkout. The same script then checks the tree right before the Author and again before the Reviewer: it restores any of those paths that changed since the overlay, removes any instruction file that appeared, and warns with each file. Restoring is the defence; it does not fail the run, because the read-only sandbox and the write guard leave only the agent runtime itself able to write there. Code that ran in between (PR postinstall scripts, the Author's tests) therefore cannot steer an agent.
3. **Fork PRs skip the agent.** `pull_request` runs get no secrets. The workflow never combines `pull_request_target` with a checkout of the PR head. A manual dispatch on a fork PR fails in `scope`.
4. **Container sandbox.** `.github/scripts/agent/sandbox.sh` runs npm tasks in a Docker container from a pinned image. The container gets no host environment, so the key is not inside. `install` has network access and no secret. `test` and `typecheck` run with no network. Dependencies live in Docker volumes, so the host's `node_modules` is not touched. The checkout is mounted read-only as a whole, so code in the container cannot change the hook script, the agent config, instruction files, git config or source. The only writable paths are the dependency volume, `backend/src/generated` during `install` (the Prisma client, git-ignored) and `<package>/coverage` during `test` (git-ignored; vitest reports go to `coverage/report`). The Author writes test files with its own tools on the host, never inside the container.
5. **Write guard, applied twice.** During the agent run, a PreToolUse hook refuses writes outside the test paths, and every shell command not listed in `AGENT_COMMANDS`, so the shell cannot write files either. Before the Bot commit, `bot_commit` checks the patch for non-test paths and symlinks. Both use the same rules in `.github/scripts/contracts/rules.ts`.
6. **PR text is data.** The agents are told not to follow instructions in it. The report sanitises agent text: it strips HTML, neutralises mentions and issue references, and removes links and images that point to other hosts.

## Consequences

- The model key is meant to stay out of every container, and PR code is meant never to run next to it. To check this, run a probe test through `sandbox.sh test backend`: it should see no `ANTHROPIC_API_KEY`, fail to fetch an external URL, and fail with `EROFS` when it writes anywhere in the checkout except `<package>/coverage`: `.git`, `.github`, `.claude`, `CLAUDE.md`, `backend/src`. A postinstall probe during `install` should likewise fail everywhere except `backend/src/generated`.
- Known gaps in the isolation are listed under limitations in [SOLUTION.md](../../SOLUTION.md). This ADR does not restate them.
- `suites` runs PR code on the runner host without secrets. The invariant allows this.
- Agent transcripts are not published, not even as an artifact, because they carry PR text and tool output. The `agents` log lists only the tool calls the permission rules denied.
- Fork PRs get no agent run and no status. A maintainer merges them by pushing the branch into the repo.
- A PR that changes `.claude/` or `.github/` cannot test its own agent config, because the run uses the base copy. See [ADR 0005](0005-gate-merges-on-test-agent-verify.md) for the skip label used on such PRs, and [ADR 0009](0009-test-agent-config-changes-against-committed-cases.md) for how such a change is tested before the merge.
- The workflow file comes from the PR head, but the scripts it runs come from the base. A PR that renames a job id the scripts read (`context.ts` reads `needs.<job>`) must keep its own run working: the scripts accept the old ids until no open PR uses them, and the PR's workflow passes the old ids to the base copy.

## Status

Accepted.
