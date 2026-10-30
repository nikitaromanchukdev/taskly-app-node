#!/usr/bin/env bash
# suites job: run a checked-out tree's checks and write the raw reports results.ts reads. Usage:
#   verify.sh checks   <tree> <out-dir>              install, typecheck, suite with coverage, per package;
#                                                    then the tests of the workflow's own scripts
#   verify.sh mutation <tree> <out-dir> <scope.json> StrykerJS on the changed files, per package (after checks)
#   verify.sh defects  <tree> <out-dir> <defects-dir> the Defect tests (defects.patch, defects.json from bot_commit) on a
#                                                    copy of the tree, with no network where the runner allows it;
#                                                    <pkg>.defects.json is the vitest report. They fail on purpose: exit 0.
# Runs PR code, so the job holding it has a read-only token and no secrets.
# `checks` exits 1 when any install, typecheck, suite or script test failed, after writing every report: the job result
# (needs.suites.result) is what lets the status be green. The reports are untrusted data and can only make it worse.
# The log names the tree (head: the analyzed PR head; final: the Bot commit, or the head when there is none) and its
# SHA, folds each package's work into a `<package> · <tree> · <what>` group, and ends with one summary line per package.
set -uo pipefail

mode="${1:?mode}" tree="$(cd "${2:?tree}" && pwd)"
mkdir -p "${3:?out-dir}"
out="$(cd "$3" && pwd)"
scope="${4:+$(realpath "$4")}"
label="$(basename "$tree")"
summary=()
failed=0

case "$mode" in
  checks | mutation | defects) ;;
  *) echo "usage: verify.sh <checks|mutation|defects> <tree> <out-dir> [scope.json|defects-dir]" >&2; exit 64 ;;
esac

echo "verify.sh $mode: $label tree at $(git -C "$tree" rev-parse HEAD 2> /dev/null || echo 'unknown commit')"

# group <package> <what> <command...>: run the command inside a folded log group.
group() {
  local pkg="$1" what="$2"
  shift 2
  echo "::group::$pkg · $label · $what"
  "$@"
  local code=$?
  echo "::endgroup::"
  return "$code"
}

# The suite's counts from the vitest JSON report, or why there are none.
suite_summary() {
  jq -r '"tests \(if .success then "pass" else "fail" end) (\(.numPassedTests) passed, \(.numFailedTests) failed)"' \
    "$1" 2> /dev/null || echo "tests: no report"
}

# Mutant counts per status from the Stryker report, e.g. "Killed 12, Survived 3".
mutation_summary() {
  jq -r '[.files[].mutants[].status] | group_by(.) | map("\(.[0]) \(length)") | join(", ")' "$1" 2> /dev/null \
    || echo "no report"
}

checks() {
  local pkg="$1" typecheck=fail
  if ! group "$pkg" "npm ci" npm ci --no-audit --no-fund; then
    echo fail > "$out/$pkg.typecheck"
    failed=1
    summary+=("$pkg: npm ci failed, nothing else ran")
    return
  fi
  group "$pkg" typecheck npm run typecheck && typecheck=pass || failed=1
  echo "$typecheck" > "$out/$pkg.typecheck"
  group "$pkg" "tests with coverage" npx vitest run --coverage --coverage.reportOnFailure --reporter=default --reporter=json \
    --outputFile.json="$out/$pkg.vitest.json" || failed=1
  cp coverage/coverage-summary.json "$out/$pkg.coverage.json"
  summary+=("$pkg: typecheck $typecheck, $(suite_summary "$out/$pkg.vitest.json")")
}

mutation() {
  local pkg="$1" files
  # Only changed source files of this package, and only when its suite passed.
  files="$(jq -r --arg p "$pkg" '[.candidates[] | select(.package == $p) | .path | ltrimstr($p + "/")] | join(",")' "$scope")"
  if [[ -z "$files" ]]; then summary+=("$pkg: mutation skipped, no changed source files"); return; fi
  if ! jq -e '.success' "$out/$pkg.vitest.json" > /dev/null 2>&1; then
    summary+=("$pkg: mutation skipped, the suite did not pass")
    return
  fi
  group "$pkg" "mutation of $files" timeout 480 npx stryker run --mutate "$files"
  cp reports/mutation/mutation.json "$out/$pkg.mutation.json"
  summary+=("$pkg: mutation $(mutation_summary "$out/$pkg.mutation.json")")
}

# Runs a command with no network: a new network namespace holding only loopback, as the current user. Needs root or
# passwordless sudo and unshare, as on a GitHub runner. Without them it runs the command as it is and says so.
offline() {
  local as_root=()
  [[ "$(id -u)" != 0 ]] && as_root=(sudo -n)
  if [[ "$(uname)" == Linux ]] && command -v unshare > /dev/null && command -v setpriv > /dev/null && "${as_root[@]}" true 2> /dev/null; then
    "${as_root[@]}" unshare --net -- bash -c 'ip link set lo up || echo "verify.sh: cannot bring loopback up" >&2; u=$1 g=$2 h=$3 p=$4; shift 4; exec setpriv --reuid "$u" --regid "$g" --clear-groups env HOME="$h" PATH="$p" "$@"' \
      _ "$(id -u)" "$(id -g)" "$HOME" "$PATH" "$@"
  else
    echo "verify.sh: no network namespace here (needs Linux, unshare, setpriv, root or sudo): the Defect tests run with network"
    "$@"
  fi
}

defects() {
  local pkg="$1" files=() file
  while IFS= read -r file; do files+=("$file"); done < <(jq -r --arg p "$pkg" '[.[] | select(.package == $p) | .packageFile] | unique | .[]' "$scope/defects.json")
  if [[ ${#files[@]} -eq 0 ]]; then summary+=("$pkg: no Defect tests"); return; fi
  group "$pkg" "Defect tests (they are expected to fail)" offline npx vitest run "${files[@]}" --reporter=default --reporter=json \
    --outputFile.json="$out/$pkg.defects.json"
  summary+=("$pkg: Defect tests $(suite_summary "$out/$pkg.defects.json")")
}

# The Defect tests are new files that are not in the final tree: a copy of it takes them, and the tree stays as it was.
if [[ "$mode" == defects ]]; then
  copy="$(mktemp -d)/tree"
  cp -a "$tree" "$copy"
  if ! git -C "$copy" apply "$scope/defects.patch"; then
    echo "verify.sh defects: defects.patch does not apply to the final tree; no Defect test ran"
    exit 0
  fi
  tree="$copy"
fi

for pkg in backend frontend; do
  cd "$tree/$pkg" || exit 1
  "$mode" "$pkg"
done

# The workflow's own scripts, as this tree has them: spec output to the log, TAP to the file results.ts reads.
if [[ "$mode" == checks ]]; then
  cd "$tree" || exit 1
  group scripts "script tests" node --test --test-reporter=spec --test-reporter-destination=stdout \
    --test-reporter=tap --test-reporter-destination="$out/scripts.tap" '.github/scripts/tests/*.test.ts' || failed=1
  summary+=("scripts: $(awk '/^# (pass|fail) / { printf "%s%s %s", (n++ ? ", " : ""), $2, $3 }' "$out/scripts.tap" 2> /dev/null)")
fi

echo "verify.sh $mode: $label summary"
printf '  %s\n' "${summary[@]}"
[[ "$mode" == checks && "$failed" == 1 ]] && { echo "verify.sh checks: $label failed"; exit 1; }
exit 0
