#!/usr/bin/env bash
# One-time repo setup for the PR test engineer. Safe to re-run.
#   setup-github.sh config    Environment test-agent (main only) with the model secret, the GitHub App (key, ids, bot login),
#                             5 budget variables, skip label
#   setup-github.sh ruleset   merge-gate ruleset from .github/rulesets/main.json (the required status is pinned to the
#                             App's id, TEST_AGENT_APP_ID), then a read-back check. Run config first.
# Needs gh (logged in as a repo admin), jq and openssl (config signs a short-lived App JWT to check the installation).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ruleset_file="$root/.github/rulesets/main.json"
status_context="test-agent/verify"
environment="test-agent"
app_id_variable="TEST_AGENT_APP_ID"
app_client_variable="TEST_AGENT_APP_CLIENT_ID"
app_key_secret="TEST_AGENT_APP_PRIVATE_KEY"
bot_login_variable="TEST_AGENT_BOT_LOGIN"
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

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

# A 5-minute App JWT, signed with the key file. Prints the token only; the key is never printed.
app_jwt() { # <client id or app id> <key file>
  local now head body sig
  now="$(date +%s)"
  head="$(printf '{"alg":"RS256","typ":"JWT"}' | b64url)"
  body="$(printf '{"iat":%d,"exp":%d,"iss":"%s"}' $((now - 60)) $((now + 300)) "$1" | b64url)"
  sig="$(printf '%s.%s' "$head" "$body" | openssl dgst -sha256 -sign "$2" 2> /dev/null | b64url)" || true
  [[ -n "$sig" ]] || die "cannot sign with $2: is it the App's private key (.pem)?"
  printf '%s.%s.%s' "$head" "$body" "$sig"
}

# The GitHub App that posts test-agent/verify and pushes the Bot commit (ADR 0005).
# Creating an App needs a browser and cannot be done from here: the owner clicks the printed link.
app_config() {
  local owner kind url client_id key_file jwt app inst slug app_id bad
  owner="${repo%%/*}"
  kind="$(gh api "users/$owner" -q .type)"
  if [[ "$kind" == Organization ]]; then url="https://github.com/organizations/$owner/settings/apps/new"; else url="https://github.com/settings/apps/new"; fi
  url="$url?name=$owner-test-agent&description=Posts%20test-agent%2Fverify%20and%20pushes%20the%20Bot%20commit&url=https://github.com/$repo&public=false&webhook_active=false&contents=write&statuses=write&pull_requests=write&metadata=read"
  echo
  echo "GitHub App. If you have not created it yet, open this link, change the name if it is taken, click \"Create GitHub App\":"
  echo "  $url"
  echo "Then, on the App page: \"Generate a private key\" (a .pem file downloads), and \"Install App\" on this repository only."
  echo "The Client ID is on the App page (starts with Iv)."
  client_id="$(gh variable get "$app_client_variable" --env "$environment" 2> /dev/null || true)"
  read -erp "App Client ID [$client_id]: " value || die "no input"
  client_id="${value:-$client_id}"
  [[ -n "$client_id" ]] || die "the App Client ID is required"
  read -erp "Path of the private key .pem (Enter keeps the existing key, and skips the installation check): " key_file || die "no input"
  key_file="${key_file/#\~/$HOME}" # a typed ~ is not expanded by read
  if [[ -z "$key_file" ]]; then
    gh secret list --env "$environment" --json name -q '.[].name' | grep -qx "$app_key_secret" || die "$app_key_secret is not set in Environment $environment yet"
    echo "secret $app_key_secret kept; the App and its installation are not checked"
    gh variable get "$app_id_variable" --env "$environment" > /dev/null 2>&1 || die "$app_id_variable is not set; give the key file"
    gh variable set "$app_client_variable" --env "$environment" --body "$client_id"
    return
  fi
  [[ -r "$key_file" ]] || die "cannot read $key_file"
  grep -q 'BEGIN .*PRIVATE KEY' "$key_file" || die "$key_file is not a PEM private key"

  jwt="$(app_jwt "$client_id" "$key_file")"
  app="$(GH_TOKEN="$jwt" gh api /app)" || die "GitHub rejected the key or the Client ID"
  slug="$(jq -r .slug <<< "$app")"
  app_id="$(jq -r .id <<< "$app")"
  [[ "$(jq -r .client_id <<< "$app")" == "$client_id" ]] || die "the key belongs to another App than Client ID $client_id"
  echo "App: $slug (id $app_id)"
  inst="$(GH_TOKEN="$jwt" gh api "repos/$repo/installation")" || die "the App $slug is not installed on $repo: install it from its settings page"
  bad="$(jq -r '[(.permissions.contents, .permissions.statuses, .permissions.pull_requests) | select(. != "write")] | length' <<< "$inst")"
  [[ "$bad" == 0 ]] || die "the App needs write access to contents, statuses and pull requests on $repo; see its permissions: $(jq -r .html_url <<< "$app")/permissions"
  echo "  ✓ installed on $repo with contents, statuses and pull requests write"
  [[ "$(jq -r .repository_selection <<< "$inst")" == selected ]] || echo "  note: the App is installed on all repositories; limit it to $repo"

  gh secret set "$app_key_secret" --env "$environment" < "$key_file"
  gh variable set "$app_id_variable" --env "$environment" --body "$app_id"
  gh variable set "$app_client_variable" --env "$environment" --body "$client_id"
  gh variable set "$bot_login_variable" --body "${slug}[bot]"
  echo "Set $app_key_secret, $app_id_variable, $app_client_variable (Environment $environment) and $bot_login_variable (repo)."
  echo "Next: scripts/setup-github.sh ruleset pins test-agent/verify to this App. Delete the downloaded .pem afterwards."
}

config() {
  local secret value current name id policies
  read -erp "Model secret name [ANTHROPIC_API_KEY | CLAUDE_CODE_OAUTH_TOKEN] (Enter = ANTHROPIC_API_KEY): " secret
  secret="${secret:-ANTHROPIC_API_KEY}"
  read -rsp "$secret value (hidden, Enter keeps the existing one): " value || true
  echo
  # The model secret lives in the Environment, which only the main branch may deploy to (ADR 0004).
  gh api -X PUT "repos/$repo/environments/$environment" -F "deployment_branch_policy[protected_branches]=false" \
    -F "deployment_branch_policy[custom_branch_policies]=true" > /dev/null
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

  app_config

  for name in "${budget_vars[@]}"; do
    current="$(gh variable get "$name" 2> /dev/null || true)"
    read -erp "$name [$current]: " value || die "no input"
    value="${value:-$current}"
    [[ -n "$value" ]] || die "$name is required"
    gh variable set "$name" --body "$value"
  done

  gh label create skip-test-agent --force --color ededed \
    --description "Skip the test agent on this PR (admin or maintain only); suites still gate"
  echo "Done. Also set a monthly spend limit: https://console.anthropic.com/settings/limits"
}

ruleset() {
  local name id applied branch rules app_id payload failed=0
  name="$(jq -r .name "$ruleset_file")"
  # The status must come from the App; its id is per install, so it is not in the file.
  app_id="$(gh variable get "$app_id_variable" --env "$environment" 2> /dev/null || true)"
  [[ "$app_id" =~ ^[0-9]+$ ]] || die "$app_id_variable is not set in Environment $environment (got '$app_id'). Run: scripts/setup-github.sh config"
  payload="$(jq --argjson app "$app_id" '(.rules[] | select(.type == "required_status_checks") | .parameters.required_status_checks[]) |= (.integration_id = $app)' "$ruleset_file")"
  id="$(gh api "repos/$repo/rulesets" | jq -r --arg n "$name" '.[] | select(.name == $n) | .id')"
  if [[ -n "$id" ]]; then
    applied="$(gh api -X PUT "repos/$repo/rulesets/$id" --input - <<< "$payload")"
    echo "ruleset '$name' updated"
  else
    applied="$(gh api -X POST "repos/$repo/rulesets" --input - <<< "$payload")"
    echo "ruleset '$name' created"
  fi

  branch="$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)"
  rules="$(gh api "repos/$repo/rules/branches/$branch")"
  check() { # <label> <jq filter> [json, default: the rules on the branch]
    if jq -e "$2" <<< "${3:-$rules}" > /dev/null; then echo "  ✓ $1"; else echo "  ✗ $1"; failed=1; fi
  }
  check "pull request required" 'any(.[]; .type == "pull_request")'
  check "$status_context required, and only from the App (integration $app_id)" \
    'any(.[]; .type == "required_status_checks" and any(.parameters.required_status_checks[]; .context == "'"$status_context"'" and .integration_id == '"$app_id"'))'
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
