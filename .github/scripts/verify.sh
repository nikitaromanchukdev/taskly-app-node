#!/usr/bin/env bash
# verify job: run a checked-out tree's checks and write the raw reports results.ts reads. Usage:
#   verify.sh checks   <tree> <out-dir>              install, typecheck, suite with coverage, per package
#   verify.sh mutation <tree> <out-dir> <scope.json> StrykerJS on the changed files, per package (after checks)
# Runs PR code, so the job holding it has a read-only token and no secrets.
set -uo pipefail

mode="${1:?mode}" tree="$(cd "${2:?tree}" && pwd)"
mkdir -p "${3:?out-dir}"
out="$(cd "$3" && pwd)"
scope="${4:+$(realpath "$4")}"

for pkg in backend frontend; do
  cd "$tree/$pkg" || exit 1
  case "$mode" in
    checks)
      if ! npm ci --no-audit --no-fund; then echo fail > "$out/$pkg.typecheck"; continue; fi
      if npm run typecheck; then echo pass > "$out/$pkg.typecheck"; else echo fail > "$out/$pkg.typecheck"; fi
      npx vitest run --coverage --coverage.reportOnFailure --reporter=default --reporter=json --outputFile.json="$out/$pkg.vitest.json"
      cp coverage/coverage-summary.json "$out/$pkg.coverage.json"
      ;;
    mutation)
      # Only changed source files of this package, and only when its suite passed.
      files="$(jq -r --arg p "$pkg" '[.candidates[] | select(.package == $p) | .path | ltrimstr($p + "/")] | join(",")' "$scope")"
      [[ -n "$files" ]] && jq -e '.success' "$out/$pkg.vitest.json" > /dev/null 2>&1 || continue
      timeout 480 npx stryker run --mutate "$files"
      cp reports/mutation/mutation.json "$out/$pkg.mutation.json"
      ;;
    *) echo "usage: verify.sh <checks|mutation> <tree> <out-dir> [scope.json]" >&2; exit 64 ;;
  esac
done
exit 0
