# ConvergeKit

**AI agents can pass tests while drifting your architecture. ConvergeKit catches that.**

## 30-second demo

1. An AI agent fixes a login bug.
2. `npm test` passes — the agent declares the task complete.
3. But the patch imported the DB client straight from the UI layer.
4. `converge check` blocks closure with the exact violation.
5. `converge correction` produces a repair packet you feed back to Claude/Codex.

```text
$ npm test
✔ 3 passing            # the agent claims completion here

$ converge check
Attractor Checks:
- ui-cannot-import-db: FAILED
  src/ui/auth.js imports src/db/client.js
  (engine: dependency-cruiser)
- test-revert-rerun: PASSED

Closure: BLOCKED
Blockers:
1. ui-cannot-import-db: src/ui/auth.js imports src/db/client.js
```

Run it yourself: `bash scripts/setup-demo.sh && bash scripts/demo.sh` (uses [examples/demo-app](examples/demo-app)). The script also reproduces the second scenario — an agent that "fixes" a task by adapting the tests to its implementation, caught by **test-revert-rerun**: converge reverts the test-file changes to the diff base, re-runs the tests, and blocks closure if the implementation only passes with the modified tests.

When closure is blocked, `converge correction` turns the reports into a **Correction Packet** — structured repair instructions (violated rule, evidence, allowed repair direction, required verification, a minimal next prompt) you can feed straight back to Claude/Codex for the next round.

## What it is

ConvergeKit is a repo-native closure gate for Claude Code, Codex, OpenCode, Cline, and other coding agents: it decides whether AI-generated work may be *declared done*. It calls your repo's long-term direction an **attractor** — you define it once in `.converge/attractor.yml`, and ConvergeKit turns it into checks, fresh audits, closure gates, and agent instructions.

It helps you:

- define where your repo should converge (`.converge/attractor.yml`);
- create plans with closure criteria;
- check AI-generated diffs for drift;
- run fresh audits using live repo evidence;
- prevent agents from self-declaring completion;
- generate `CLAUDE.md` and `AGENTS.md` from the same source.

```text
Attractor → Plan → Agent Execution → Check → Fresh Audit → Closure → Memory / Handoff
```

## Quickstart

```bash
# from source (the npm package is not published yet)
git clone https://github.com/maple1999/ConvergeKit
cd ConvergeKit
npm install && npm run build && npm link

cd your-repo

converge init                # scaffolds .converge/ + docs/, infers boundary
                             # rules from your directory layout (you confirm)
converge plan "fix auth bug" --type bugfix

# ... let Claude Code / Codex / your agent work ...

converge check               # diff vs attractor + verification commands
converge audit --fresh       # independent audit from live repo evidence
converge correction          # blocked? generate a repair packet for the agent
converge close PLAN-001      # blocked unless check + audit + exit criteria pass
converge handoff             # summary for the next AI session
```

Wire your agent to the same rules:

```bash
converge compile --all       # CLAUDE.md, AGENTS.md, skills, .clinerules,
                             # .opencode/instructions.md — all generated from
                             # .converge/attractor.yml (manual sections preserved)
```

Once the npm package is published, `npm install -g convergekit` will replace the source install.

## Why not just tests?

Tests verify behavior. They do not verify that:

- the fix landed in the right layer (UI quietly importing the DB client);
- the diff stayed inside the plan's scope and non-goals;
- the tests themselves weren't weakened to match the implementation;
- the "verification logs" the agent shows you were actually produced by running anything.

ConvergeKit's closure evidence is **non-fakeable by construction**: verification commands are executed by converge itself (exit code, output hash, timestamp recorded). Pre-existing log files are advisory only.

## Why not just prompt?

`CLAUDE.md` rules are advisory — the agent can ignore, misread, or rationalize around them. ConvergeKit compiles the same rules into agent prompts *and* enforces them from outside the agent's context: CLI locally, `converge check --strict` in CI. The implementer's summary is never authoritative evidence; fresh audit re-reads the live repo.

## How is this different from X?

| Tool | What it governs | ConvergeKit's difference |
|---|---|---|
| GitHub Spec Kit / OpenSpec / Kiro | Before work: spec → plan → implement | ConvergeKit governs after: check → fresh audit → closure. A constitution defines direction; ConvergeKit verifies the direction wasn't drifted |
| dependency-cruiser / ArchUnit / import-linter | Single-point architecture rules | ConvergeKit is the closure orchestration layer — it wraps these tools (dependency-cruiser is its primary boundary engine) and feeds results into a close/no-close decision |
| CodeRabbit / Greptile / Qodo | AI PR review: bugs and quality | ConvergeKit doesn't hunt bugs. It answers one question — *can this change be closed?* — and never trusts the implementing agent's self-report |
| Beads / claude-mem / native Tasks | Task state and context memory | ConvergeKit memory records directional lessons: disproven assumptions, divergent paths, overturned closures |

One line: **spec tools govern what to do, review tools govern code quality, ConvergeKit governs whether the work may be declared done.**

## Core concepts

- **Attractor** — the stable structure your repo should repeatedly be pulled back to: architecture boundaries, dependency directions, forbidden paths, quality invariants. Declared in `.converge/attractor.yml` (v0.1: `mode: product`).
- **Plan** — a scoped unit of agent work with goals, non-goals (enforced as protected paths), exit criteria and required evidence. Plans are recommended, not mandatory: `converge check` works without one.
- **Check** — deterministic gate over the git diff: forbidden paths, dependency direction (dependency-cruiser engine with a builtin fallback), diff scope vs plan type, **test-revert-rerun** (P0 blocker), text heuristics (advisory only), and verification commands executed by converge.
- **Fresh audit** — rebuilds an evidence pack (diff, plan, attractor, check report, memory) and judges closure with an LLM (`--llm claude`, the default) or deterministically (`--no-llm`, the CI fallback). Deterministic blockers always survive the merge — the LLM never owns final authority.
- **Closure** — `Draft → Active → Implemented → Checked → Audited → Closed`, with `Blocked / Needs Rework / Needs Human Decision` branches. Human override is allowed but recorded (`closure-override.json`).
- **Memory / Handoff** — trajectory records (disproven assumptions, divergent paths, overturned closures, terminology traps) that flow into future evidence packs and session handoffs.

## CI

The quickest way is the bundled GitHub Action (composite, installs from this repo):

```yaml
name: ConvergeKit Check
on: [pull_request]
jobs:
  converge:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
      - uses: maple1999/ConvergeKit@v0.1-beta-rc1
        with:
          base: auto                # origin/$GITHUB_BASE_REF
          config-from-base: auto    # trust boundary: attractor from base branch
          strict: true
          audit: no-llm
```

CI semantics — deterministic blockers short-circuit closure:

- `converge check` **fails** → the fresh audit is *skipped*; the action appends a Correction Packet to the job summary instead.
- `converge check` **passes** → the fresh audit runs (unless `audit: none`).

Or run the CLI directly:

```yaml
      - run: git clone --depth 1 https://github.com/maple1999/ConvergeKit /tmp/ck
        # after the npm release: npm install -g convergekit
      - run: cd /tmp/ck && npm ci && npm run build && npm link
      - run: converge check --strict --base auto --config-from-base auto
      - run: converge audit --fresh --no-llm --base auto --config-from-base auto
```

`error`-severity blockers fail CI; warnings report without failing (`--strict` escalates them); advisory findings are recorded only.

## Security model

ConvergeKit is an *external acceptance layer* for untrusted patches — including patches that try to modify ConvergeKit's own rules. The trust boundaries:

- **CI never trusts the PR head's config.** With `--config-from-base <ref>` (or `auto`), `.converge/attractor.yml` — including the verification commands converge executes — is read from the base branch via `git show`, not from the checked-out PR. A PR that deletes a boundary rule or swaps `npm test` for `echo ok` changes nothing about how it is judged.
- **Attractor changes require a human.** Any diff touching `.converge/attractor.yml` (or `.converge/templates/`, `.converge/profiles/`) raises `attractor-config-modified`. It is neither a pass nor a plain failure: the fresh audit maps it to **Needs Human Decision**, and closure requires `converge close --human-approved --reason "..."` (recorded in `closure-override.json`).
- **Verification evidence is non-fakeable by construction.** Commands are executed by converge itself; exit code, output hash and timestamps are recorded. Pre-existing logs are advisory only.
- **test-revert-rerun cleans up after itself.** In-place mode snapshots test files, verifies the restore byte-for-byte, and *fails the check* if restoration failed or the working tree was left dirty (`test-revert-restore`, `working-tree-side-effects`). `--test-integrity-mode isolated` (experimental) runs the whole revert-rerun in a temporary detached git worktree and never touches your working tree; if the isolated environment needs setup, configure `verification.setup_for_isolated` (e.g. `npm ci`).
- **Side effects are reported, not hidden.** Test commands that generate snapshots/coverage/cache files show up as a warning (a blocker under `--strict`); anything that *reverts your uncommitted changes* is a blocker outright.
- **Untracked files don't slip through.** Forbidden-path rules match both the tracked diff *and* untracked files — an agent-created `.env` blocks closure even before `git add`.

Known boundaries: files matched by `.gitignore` are not scanned (side-effect detection and untracked forbidden files both rely on `git status`/`git ls-files`); a future `--scan-forbidden-filesystem` mode may cover them. The LLM audit is advisory-merged — deterministic blockers always survive; the LLM never owns final authority.

## The correction loop

Blocking is only half the job; the other half is steering the next attempt:

```text
agent patch → converge check: BLOCKED
            → converge correction --for claude
            → agent applies the packet (fix stays, violation goes)
            → converge check: PASSED → converge audit --fresh → converge close
```

The packet (`.converge/reports/<PLAN>/correction.md`) contains the violated rule, the evidence, an **allowed repair direction**, required verification commands, and an explicit *Do Not* list (don't weaken tests, don't edit the attractor, don't refactor beyond scope). `--for claude` / `--for codex` adjust framing only — the facts come from the same `check.json` / `audit.json`.

## What ConvergeKit is not

- Not a coding agent, and not a Claude Code / Codex replacement — it gates their output.
- Not a PR review bot: it doesn't hunt bugs or style issues; it answers *may this be declared done?*
- Not a spec/plan generator: plans are scoped closure contracts, not designs.
- Not a sandbox: verification commands run with your shell's permissions. Point it at repos you trust to build.
- Skills/`CLAUDE.md` are *entry points* for agents; the CLI and CI runs are the authority.

## Commands

| Command | Purpose |
|---|---|
| `converge init` | Scaffold `.converge/` + `docs/`, infer boundary-rule drafts from directory layout |
| `converge plan "<title>" --type bugfix\|feature\|refactor` | Create a numbered plan, set it active |
| `converge check [--json] [--strict] [--base <ref>\|auto] [--config-from-base <ref>\|auto] [--test-integrity-mode in-place\|isolated] [--no-exec]` | Full deterministic gate; exit 1 when blocked |
| `converge audit --fresh [--llm claude\|codex] [--no-llm] [--base <ref>\|auto] [--config-from-base <ref>\|auto]` | Evidence pack + independent audit |
| `converge correction [--plan <id>] [--for claude\|codex] [--json]` | Correction Packet from the latest check/audit reports |
| `converge close <PLAN-ID> [--force\|--human-approved --reason <r>] [--config-from-base <ref>]` | Close a plan; refuses while blockers exist |
| `converge closure-status [PLAN-ID]` | Closure state for CI |
| `converge handoff [--for claude\|codex]` | Cross-session handoff summary |
| `converge memory add --type <type> --summary <s>` | Record a trajectory lesson |
| `converge compile --target claude\|codex\|opencode\|cline [--all] [--with-hooks]` | Generate agent configs from the attractor |

## Claude Code integration

```bash
converge compile --target claude               # CLAUDE.md + skills (incl. converge-correction)
converge compile --target claude --with-hooks  # opt-in: Stop hook that blocks "done" while closure is blocked
```

The Stop hook (`.claude/hooks/converge-stop-check.sh`) runs a fast `converge check --no-exec` when the session tries to finish; if closure is blocked it feeds "run `converge correction`" back to the agent (once — it never loops). Remove the entry from `.claude/settings.json` to disable. Skills are entry points; the hook, CLI and CI remain the authority.

## Status & roadmap

v0.1-beta (this release): product mode, JS/TS boundary checking, the full closure loop, CI trust boundary (`--config-from-base`), safe test-revert-rerun (restore verification + isolated mode), Correction Packets, GitHub Action, Claude/Codex/OpenCode/Cline compilation with opt-in Claude hooks. See [ConvergeKit_PRD_v0.1.md](ConvergeKit_PRD_v0.1.md) for the full PRD, including v0.2+ (holdout tests, Python via import-linter, MCP server) and v0.3+ (research / venture modes).

## Development

```bash
npm install
npm run build     # tsc → dist/
npm test          # vitest: unit + end-to-end on temp git fixtures
bash scripts/setup-demo.sh && bash scripts/demo.sh
```

CI (GitHub Actions) runs the test suite on Ubuntu and Windows plus the full demo on every push/PR.

MIT license — see [LICENSE](LICENSE).
