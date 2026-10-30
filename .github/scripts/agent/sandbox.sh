#!/usr/bin/env bash
# Run npm tasks for one package in a keyless container. Usage:
#   sandbox.sh <install|test|typecheck> <backend|frontend> [vitest args]
# The container gets no host environment, so the model key is never inside.
# install needs the registry; test and typecheck run with no network.
# node_modules lives in a Docker volume per repo checkout and package: the container gets Linux
# binaries, and the host's own node_modules stays untouched. Run install before test or typecheck.
set -euo pipefail

IMAGE="node:24@sha256:e2007d1f4e652444f88d9bb196256d2d035269015e3d27a0d47c1d0cb5192a98"

action="${1:-}"
package="${2:-}"
[[ "$action" =~ ^(install|test|typecheck)$ && "$package" =~ ^(backend|frontend)$ ]] || {
  echo "usage: sandbox.sh <install|test|typecheck> <backend|frontend> [args]" >&2
  exit 64
}
shift 2

# Mount the repo root wherever the script is called from.
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cache="${HOME:?HOME is not set}/.cache/test-agent-npm"
mkdir -p "$cache"
modules="test-agent-$(printf %s "$root" | cksum | cut -d' ' -f1)-$package-modules"
user="$(id -u):$(id -g)"

# The checkout is mounted read-only, so code in the container cannot write agent instructions (CLAUDE.md,
# AGENTS.md, .mcp.json, .claude), the hook and workflow scripts (.github), git config or hooks (.git), or source.
# The only writable paths are volumes and these directories, which the host needs or creates:
#   install:   backend/src/generated (`prisma generate` output; gitignored)
#   test:      <package>/coverage (gitignored). Vitest removes its reports directory before a run and cannot remove a
#              mount point, so the reports go to coverage/report; the Makefile reads coverage/report/coverage-summary.json.
#   typecheck: nothing (tsc --noEmit)
writable=()
case "$action:$package" in
  install:backend) writable+=(backend/src/generated) ;;
  test:*)          writable+=("$package/coverage") ;;
esac
# Docker cannot create a mount point inside a read-only mount, so the host creates the empty ones.
mkdir -p "$root/$package/node_modules"
mounts=()
for dir in ${writable[@]+"${writable[@]}"}; do
  mkdir -p "$root/$dir"
  mounts+=(-v "$root/$dir:/w/$dir")
done

network=none
case "$action" in
  install)
    network=bridge
    cmd=(npm ci)
    # A new volume is owned by root; hand it to the calling user.
    docker run --rm --network=none -v "$modules":/m "$IMAGE" chown "$user" /m
    ;;
  test)      cmd=(node_modules/.bin/vitest run "$@" --coverage.reportsDirectory=coverage/report) ;;
  typecheck) cmd=(node_modules/.bin/tsc --noEmit "$@") ;;
esac
[[ "$action" == install ]] || docker volume inspect "$modules" > /dev/null 2>&1 || {
  echo "sandbox.sh: no dependencies for $package yet; run: sandbox.sh install $package" >&2
  exit 1
}

# HOME is a writable dir (the container's own, not the checkout) so a non-root uid can run npm and prisma.
exec docker run --rm \
  --user "$user" \
  --network="$network" \
  -e HOME=/tmp -e npm_config_cache=/npm-cache -e CI=true \
  -v "$root":/w:ro ${mounts[@]+"${mounts[@]}"} -v "$modules":"/w/$package/node_modules" -v "$cache":/npm-cache \
  -w "/w/$package" \
  "$IMAGE" "${cmd[@]}"
