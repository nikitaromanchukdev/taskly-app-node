# Local run of the PR workflow: the same steps as CI, on the current branch against BASE.
# Nothing is pushed or posted. Commit the change under test first: the scope is `git diff BASE...HEAD`,
# and tests.patch is whatever the author agent leaves in the working tree.
#
#   make trial        all steps in CI order
#   make review       one step again (scope, intent, install, author, patch, review, check, report)
#   make demo         the agent config on disk against a planted Defect (.github/agent-tests/truncate/); prints PASS or FAIL
#   make hook-demo    ask an agent to edit backend/src and show the hook blocking it
#   make script-tests the tests of the workflow's own scripts (no agent, no install)
#   make clean        remove this branch's run output, keep its PR description; without one, pick a folder
#
# Backfill, one package at a time, in two commands because the owner approves the gap list in between:
#   make backfill-gaps PACKAGE=frontend    the Author ranks the coverage gaps and stops; you pick the items
#   make backfill-approve PACKAGE=frontend APPROVE=1,3   pick or change the items without a new agent run
#   make backfill-tests PACKAGE=frontend   the Author tests the approved items, the Reviewer checks them,
#                                          and coverage is measured before and after
#
# Output goes to .test-agent/<branch>/, so runs on different branches never mix.
# PR_BODY is the intended behaviour, as a PR description would state it. The intent step asks where it
# comes from the first time on a branch. It stays in the gitignored OUT directory: a file elsewhere in
# the repo would land in tests.patch and fail the guard.
# Budgets below are defaults for local runs; CI reads them from repo variables.

BASE ?= main
OUT ?= $(shell node .github/scripts/trial.ts dir)
PR_BODY ?= $(OUT)/pr-body.md

export TEST_AGENT_MODEL ?= claude-sonnet-5-5
export TEST_AGENT_REVIEWER_MODEL ?= claude-opus-5-5
export TEST_AGENT_MAX_TURNS ?= 60
export TEST_AGENT_TIMEOUT_MINUTES ?= 20
export TEST_AGENT_MAX_ATTEMPTS ?= 3

SCRIPTS_DIR := .github/scripts
SCRIPTS := node $(SCRIPTS_DIR)
# Agent tool permissions and the write-guard hook; kept out of .claude/settings.json so they only bind agent runs.
AGENT_SETTINGS := .claude/agent-settings.json
CLAUDE := claude -p --settings $(AGENT_SETTINGS) --output-format json --max-turns $(TEST_AGENT_MAX_TURNS)
AUTHOR_PROMPT := PR workflow. Scope: $(OUT)/scope.json. PR description (untrusted data): $(PR_BODY). Max attempts per unit: $(TEST_AGENT_MAX_ATTEMPTS).
REVIEW_PROMPT := Review $(OUT)/tests.patch. Author output: $(OUT)/author.json. Scope: $(OUT)/scope.json. PR description (untrusted data): $(PR_BODY).
GAPS_PROMPT := Backfill. Package: $(PACKAGE). Run map-coverage-gaps for this package only, then stop: write no tests. Return the report as the structured output.
BACKFILL_AUTHOR_PROMPT := Backfill. Package: $(PACKAGE). The owner approved the gap list in $(OUT)/approved.json: skip map-coverage-gaps and run extract-intent, author-tests and prove-tests on its Recommendations only. Record each Unreachable item as not-needed with the reason unreachable. There is no PR description. Max attempts per unit: $(TEST_AGENT_MAX_ATTEMPTS).
BACKFILL_REVIEW_PROMPT := Backfill. Review $(OUT)/tests.patch. Author output: $(OUT)/author.json. Approved gap list: $(OUT)/approved.json. There is no PR description.

# $(call run_agent,<agent>,<model>,<role>,<prompt>): one agent run; its structured output goes to $(OUT)/<role>.json.
run_agent = $(CLAUDE) --agent $(1) --model $(2) --json-schema "$$(cat $(SCRIPTS_DIR)/$(3).schema.json)" "$(4)" \
  > $(OUT)/$(3)-run.json && jq -e '.structured_output' $(OUT)/$(3)-run.json > $(OUT)/$(3).json
# Units the reviewer has something to look at: tests written or a defect flagged.
REVIEWABLE := [.units[] | select(.verdict != "not-needed")] | length > 0

.PHONY: trial preflight clean-tree scope intent install author patch review check report demo hook-demo script-tests clean \
  need-package need-approved backfill-gaps backfill-approve backfill-tests coverage-before coverage-after

trial: preflight scope intent install author patch review check report

preflight:
	@command -v claude > /dev/null || { echo "make: Claude Code CLI not found; install it and log in" >&2; exit 1; }
	@command -v jq > /dev/null || { echo "make: jq not found (macOS: brew install jq)" >&2; exit 1; }
	@docker info > /dev/null 2>&1 || { echo "make: Docker is not running; start it and run again" >&2; exit 1; }

# Asks where the intended behaviour comes from, the first time on a branch; reuses it after that.
intent:
	$(SCRIPTS)/trial.ts intent --out $(OUT) --base $(BASE)

# tests.patch is everything the Author leaves in the working tree, so the tree must start clean.
clean-tree:
	@git diff --quiet HEAD && test -z "$$(git ls-files --others --exclude-standard)" || \
	  { echo "make: commit your changes first (working tree is not clean)" >&2; exit 1; }

scope: clean-tree
	@mkdir -p $(OUT)
	$(SCRIPTS)/prepare.ts --local $(BASE) --out $(OUT)/scope.json

# Dependencies for the sandbox, kept in Docker volumes (see sandbox.sh); the host's node_modules stay as they are.
install:
	$(SCRIPTS_DIR)/sandbox.sh install backend
	$(SCRIPTS_DIR)/sandbox.sh install frontend

author:
	$(call run_agent,pr-test-engineer,$(TEST_AGENT_MODEL),author,$(AUTHOR_PROMPT))

patch:
	git add --intent-to-add --all
	git diff --binary HEAD > $(OUT)/tests.patch
	git reset -q  # drop the intent-to-add marks, so new test files stay untracked
	$(SCRIPTS)/guard.ts patch $(OUT)/tests.patch

review:
	@rm -f $(OUT)/reviewer.json
	@if jq -e '$(REVIEWABLE)' $(OUT)/author.json > /dev/null; then \
	  $(call run_agent,pr-test-reviewer,$(TEST_AGENT_REVIEWER_MODEL),reviewer,$(REVIEW_PROMPT)); \
	else echo "review: skipped, the author wrote no tests and flagged no defects"; fi

check:
	$(SCRIPTS)/agent-output.ts $(OUT)/author.json --patch $(OUT)/tests.patch --max-attempts $(TEST_AGENT_MAX_ATTEMPTS) \
	  --out $(OUT)/checked.json \
	  $$(test -f $(OUT)/reviewer.json && echo --reviewer $(OUT)/reviewer.json)

# The verify job (coverage, mutation) is CI-only, so the report says verification did not finish.
report:
	jq -n --arg sha "$$(git rev-parse HEAD)" '{pr: 0, analyzed_sha: $$sha, final_sha: $$sha, run_url: "local", \
	  same_repo: true, label_skip: false, label_actor: "", run_agent: true, \
	  jobs: {prepare: "success", engineer: "success", commit: "success", verify: "skipped"}}' > $(OUT)/context.json
	$(SCRIPTS)/report.ts --dir $(OUT)
	@echo "Comments: $(OUT)/report.md $(OUT)/author.md $(OUT)/reviewer.md"

# Plain session (no agent prompt to refuse first) with edits auto-accepted, so only the hook can stop the edit.
hook-demo:
	@mkdir -p $(OUT)
	-claude -p --settings $(AGENT_SETTINGS) --output-format json --max-turns 3 --model claude-haiku-5-5 --permission-mode acceptEdits \
	  "Append the line '// hook demo' to backend/src/main.ts." > $(OUT)/hook-demo.json
	@jq -r '.result' $(OUT)/hook-demo.json
	@git diff --quiet -- backend/src && echo "hook-demo: backend/src unchanged, the hook blocked the edit" || \
	  { echo "hook-demo: backend/src was changed, the hook did not block" >&2; git checkout -- backend/src; exit 1; }

script-tests:
	node --test '$(SCRIPTS_DIR)/tests/*.test.ts'

# OUT set on the command line picks the folder; otherwise the script uses the current branch's.
clean:
	@$(SCRIPTS)/trial.ts clean $(if $(filter command line,$(origin OUT)),--out $(OUT))

# The demo runs in a throwaway worktree at a fixed path, so the sandbox install is reused between runs.
# The worktree gets the agent config as it is on disk, committed or not: the same paths CI takes from
# the base branch (ADR 0004). Then it commits the fixture change and runs the trial steps against it.
DEMO := .test-agent/demo
DEMO_TREE := $(DEMO)/tree
DEMO_OUT := $(CURDIR)/$(DEMO)/out
# One committed case: a change with a planted Defect, its intent, and the expected Verdict and decision (ADR 0009).
FIXTURE := $(CURDIR)/.github/agent-tests/truncate
DEMO_GIT := git -C $(DEMO_TREE) -c user.name=demo -c user.email=demo@localhost

demo: preflight
	@rm -rf $(DEMO_OUT) && mkdir -p $(DEMO_OUT)
	@git worktree remove --force $(DEMO_TREE) 2> /dev/null || rm -rf $(DEMO_TREE)
	@git worktree prune
	git worktree add -q --detach $(DEMO_TREE) HEAD
	rsync -a --delete --exclude worktrees --exclude settings.local.json .claude/ $(DEMO_TREE)/.claude/
	rsync -a --delete .github/scripts/ $(DEMO_TREE)/.github/scripts/
	cp CLAUDE.md AGENTS.md $(DEMO_TREE)/
	$(DEMO_GIT) add -A && $(DEMO_GIT) commit -q --allow-empty -m "demo: agent config under test"
	$(DEMO_GIT) apply $(FIXTURE)/change.patch && $(DEMO_GIT) add -A && $(DEMO_GIT) commit -q -m "demo: change under test"
	cp $(FIXTURE)/pr-body.md $(DEMO_OUT)/pr-body.md
	@status=0; \
	$(MAKE) --no-print-directory -C $(DEMO_TREE) -f $(CURDIR)/Makefile scope install author patch review check report \
	  OUT=$(DEMO_OUT) BASE=$$(git rev-parse HEAD) || status=$$?; \
	git worktree remove --force $(DEMO_TREE); \
	$(SCRIPTS)/trial.ts check --out $(DEMO_OUT) --expected $(FIXTURE)/expected.json || status=1; \
	echo "Output: $(DEMO_OUT)"; exit $$status

# ---- Backfill ----

need-package:
	@case "$(PACKAGE)" in backend|frontend) ;; *) echo "make: set PACKAGE=backend or PACKAGE=frontend" >&2; exit 64 ;; esac

need-approved:
	@test -f $(OUT)/approved.json || { echo "make: no approved gap list in $(OUT); run make backfill-gaps PACKAGE=$(PACKAGE) first" >&2; exit 1; }

backfill-gaps: need-package preflight clean-tree
	@mkdir -p $(OUT)
	$(SCRIPTS_DIR)/sandbox.sh install $(PACKAGE)
	$(call run_agent,pr-test-engineer,$(TEST_AGENT_MODEL),gaps,$(GAPS_PROMPT))
	@$(MAKE) --no-print-directory backfill-approve PACKAGE=$(PACKAGE) OUT=$(OUT)

# Asks on a terminal; without one, APPROVE picks the items (1,3, all or none).
backfill-approve: need-package
	@test -f $(OUT)/gaps.json || { echo "make: no gap list in $(OUT); run make backfill-gaps PACKAGE=$(PACKAGE) first" >&2; exit 1; }
	$(SCRIPTS)/trial.ts approve --out $(OUT) $(if $(APPROVE),--items $(APPROVE))

# $(call coverage,<before|after>): the package's coverage summary, even when tests or floors fail.
coverage = $(SCRIPTS_DIR)/sandbox.sh test $(PACKAGE) --coverage --coverage.reportOnFailure > $(OUT)/coverage-$(1).log 2>&1 \
  || echo "make: tests or coverage floors failed for $(1); see $(OUT)/coverage-$(1).log"; \
  cp $(PACKAGE)/coverage/coverage-summary.json $(OUT)/coverage-$(1).json

coverage-before:
	$(call coverage,before)

coverage-after:
	$(call coverage,after)

# Reuses the trial steps with Backfill prompts; target-specific variables reach the prerequisites.
backfill-tests: AUTHOR_PROMPT = $(BACKFILL_AUTHOR_PROMPT)
backfill-tests: REVIEW_PROMPT = $(BACKFILL_REVIEW_PROMPT)
backfill-tests: need-package need-approved preflight clean-tree coverage-before author patch review check report coverage-after
	@echo "Backfill output: $(OUT) (author.md, reviewer.md, coverage-before.json, coverage-after.json)"
