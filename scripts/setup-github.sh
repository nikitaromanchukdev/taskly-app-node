#!/usr/bin/env bash
# One-time repo setup for the PR test engineer. Safe to re-run.
#   setup-github.sh config    Environment test-agent (main only) with the model secret, 5 budget variables, skip label
#   setup-github.sh ruleset   merge-gate ruleset from .github/rulesets/main.json, then a read-back check
# Needs gh (logged in as a repo admin) and jq.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ruleset_file="$root/.github/rulesets/main.json"
status_context="test-agent/verify"
environment="test-agent"
budget_vars=(TEST_AGENT_MODEL TEST_AGENT_REVIEWER_MODEL TEST_AGENT_MAX_TURNS TEST_AGENT_TIMEOUT_MINUTES TEST_AGENT_MAX_ATTEMPTS)

die() { echo "setup-github: $*" >&2; exit 1; }

preflight() {
  command -v gh > /dev/null || die "gh is not installed"
  command -v jq > /dev/null || die "jq is not installed"
  gh auth status > /dev/null 2>&1 || die "run: gh auth login"
  repo="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
  [[ "$(gh repo view --json viewerPermission -q .viewerPermission)" == ADMIN ]] || die "you need ADMIN on $repo"
  echo "Repo: $repo"
}

config() {
  local secret value current name id policies
  read -rp "Model secret name [ANTHROPIC_API_KEY | CLAUDE_CODE_OAUTH_TOKEN] (Enter = ANTHROPIC_API_KEY): " secret
  secret="${secret:-ANTHROPIC_API_KEY}"
  read -rsp "$secret value (hidden, Enter keeps the existing one): " value || true
  echo
  # The model secret lives in the Environment, which only the main branch may deploy to (ADR 0004).
  gh api -X PUT "repos/$repo/environments/$environment" -F deployment_branch_policy[protected_branches]=false \
    -F deployment_branch_policy[custom_branch_policies]=true > /dev/null
  policies="$(gh api "repos/$repo/environments/$environment/deployment-branch-policies" -q .branch_policies)"
  for id in $(jq -r '.[] | select(.name != "main") | .id' <<< "$policies"); do
    gh api -X DELETE "repos/$repo/environments/$environment/deployment-branch-policies/$id"
  done
  jq -e 'any(.[]; .name == "main")' <<< "$policies" > /dev/null \
    || gh api -X POST "repos/$repo/environments/$environment/deployment-branch-policies" -f name=main -f type=branch > /dev/null
  echo "Environment $environment: deployment branches limited to main"
  if [[ -n "$value" ]]; then
    gh secret set "$secret" --env "$environment" --body "$value"
  else
    gh secret list --env "$environment" --json name -q '.[].name' | grep -qx "$secret" || die "$secret is not set in Environment $environment yet"
    echo "secret $secret kept"
  fi
  if gh secret list --json name -q '.[].name' | grep -Eqx 'ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN'; then
    echo "Reminder: once the workflow works, delete the repo-level model secrets (gh secret delete <name>). Workflow pr-intake runs from PRs and must not see them."
  fi

  for name in "${budget_vars[@]}"; do
    current="$(gh variable get "$name" 2> /dev/null || true)"
    read -rp "$name [$current]: " value || die "no input"
    value="${value:-$current}"
    [[ -n "$value" ]] || die "$name is required"
    gh variable set "$name" --body "$value"
  done

  gh label create skip-test-agent --force --color ededed \
    --description "Skip the test agent on this PR (admin or maintain only); suites still gate"
  echo "Done. Also set a monthly spend limit: https://console.anthropic.com/settings/limits"
}

ruleset() {
  local name id applied branch rules failed=0
  name="$(jq -r .name "$ruleset_file")"
  id="$(gh api "repos/$repo/rulesets" | jq -r --arg n "$name" '.[] | select(.name == $n) | .id')"
  if [[ -n "$id" ]]; then
    applied="$(gh api -X PUT "repos/$repo/rulesets/$id" --input "$ruleset_file")"
    echo "ruleset '$name' updated"
  else
    applied="$(gh api -X POST "repos/$repo/rulesets" --input "$ruleset_file")"
    echo "ruleset '$name' created"
  fi

  branch="$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)"
  rules="$(gh api "repos/$repo/rules/branches/$branch")"
  check() { # <label> <jq filter> [json, default: the rules on the branch]
    if jq -e "$2" <<< "${3:-$rules}" > /dev/null; then echo "  ✓ $1"; else echo "  ✗ $1"; failed=1; fi
  }
  check "pull request required" 'any(.[]; .type == "pull_request")'
  check "$status_context required" \
    'any(.[]; .type == "required_status_checks" and any(.parameters.required_status_checks[]; .context == "'"$status_context"'"))'
  check "$status_context must pass on a branch up to date with $branch" \
    'any(.[]; .type == "required_status_checks" and .parameters.strict_required_status_checks_policy == true)'
  check "force-push blocked" 'any(.[]; .type == "non_fast_forward")'
  # The rules endpoint does not list bypass actors, so this reads the ruleset the API returned.
  check "only admins may bypass, and only through a PR" \
    '.bypass_actors | length == 1 and (.[0] | .actor_type == "RepositoryRole" and .actor_id == 5 and .bypass_mode == "pull_request")' "$applied"
  return "$failed"
}

case "${1:-}" in
  config) preflight; config ;;
  ruleset) preflight; ruleset ;;
  *) echo "usage: setup-github.sh <config|ruleset>" >&2; exit 64 ;;
esac
