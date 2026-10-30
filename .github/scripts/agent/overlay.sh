#!/usr/bin/env bash
# The agents job runs the PR head with agent config and scripts from the base commit. Usage:
#   overlay.sh apply <base-sha> <overlay.sha file>   replace the PR's agent config with base's and commit it as "overlay"
#   overlay.sh check <overlay.sha file>              restore those paths from the overlay commit; warn about each one that had changed
# Run a copy of this script taken from the base commit, never the one in the checkout: apply runs before the checkout
# holds base's scripts, and check must not trust a file that PR code could have written.
# Agents load every CLAUDE.md, CLAUDE.local.md and AGENTS.md they find, so a file written by PR code (a postinstall,
# a test) between the overlay and an agent would steer that agent. check runs right before the Author and the Reviewer.
set -euo pipefail

mode="${1:-}"

# Instruction files at any depth, and the directories and files base owns.
nested=(':(glob)**/.claude/**' ':(glob)**/CLAUDE.md' ':(glob)**/CLAUDE.local.md' ':(glob)**/AGENTS.md')
owned=(.claude CLAUDE.md AGENTS.md .mcp.json .github/scripts)

case "$mode" in
  apply)
    base="${2:?base sha}" sha_file="${3:?overlay.sha file}"
    # Drop every agent instruction file the PR could have added anywhere (nested CLAUDE.md files load too).
    git rm -rqf --ignore-unmatch -- "${nested[@]}" .mcp.json .github/scripts
    for p in "${owned[@]}"; do
      if git cat-file -e "$base:$p" 2> /dev/null; then git checkout "$base" -- "$p"; fi
    done
    git -c user.name=ci -c user.email=ci@localhost commit -q --allow-empty -m overlay
    git rev-parse HEAD > "$sha_file"
    ;;
  check)
    overlay="$(cat "${2:?overlay.sha file}")"
    # Changed against the overlay commit (tracked, staged or deleted), and untracked, ignored files included.
    found=()
    while IFS= read -r f; do found+=("$f"); done < <({
      git diff --name-only "$overlay" -- "${nested[@]}" "${owned[@]}"
      git ls-files --others -- "${nested[@]}" "${owned[@]}"
    } | sort -u)
    if [[ ${#found[@]} -eq 0 ]]; then
      echo "overlay check: agent config and instruction files are as the overlay left them"
      exit 0
    fi
    echo "::warning::overlay check: ${#found[@]} agent config or instruction file(s) changed since the overlay; restoring them" >&2
    for f in "${found[@]}"; do
      if git cat-file -e "$overlay:$f" 2> /dev/null; then
        echo "  restored $f" >&2
        git checkout "$overlay" -- "$f"
      else
        echo "  removed  $f" >&2
        git rm -qf --cached --ignore-unmatch -- "$f"
        rm -f -- "$f"
      fi
    done
    # Restoring is the defence. The sandbox and the write guard leave nothing else that can write these paths, so a
    # failed run here would only flag files the agent runtime itself left behind.
    exit 0
    ;;
  *)
    echo "usage: overlay.sh apply <base-sha> <overlay.sha file> | check <overlay.sha file>" >&2
    exit 64
    ;;
esac
