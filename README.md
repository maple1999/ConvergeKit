# ConvergeKit

**AI agents can pass tests while drifting your architecture. ConvergeKit catches that.**

ConvergeKit is a repo-native, attractor-first harness for Claude Code, Codex, OpenCode, Cline, and other coding agents.

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

## The demo: tests passed, closure blocked

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

Run it yourself: `bash scripts/demo.sh` (uses [examples/demo-app](examples/demo-app)). The script also reproduces the second scenario — an agent that "fixes" a task by adapting the tests to its implementation, caught by **test-revert-rerun**: converge reverts the test-file changes to the diff base, re-runs the tests, and blocks closure if the implementation only passes with the modified tests.

## Quickstart

```bash
npm install -g convergekit   # or: npm link from a checkout
cd your-repo

converge init                # scaffolds .converge/ + docs/, infers boundary
                             # rules from your directory layout (you confirm)
converge plan "fix auth bug" --type bugfix

# ... let Claude Code / Codex / your agent work ...

converge check               # diff vs attractor + verification commands
converge audit --fresh       # independent audit from live repo evidence
converge close PLAN-001      # blocked unless check + audit + exit criteria pass
converge handoff             # summary for the next AI session
```

Wire your agent to the same rules:

```bash
converge compile --all       # CLAUDE.md, AGENTS.md, skills, .clinerules,
                             # .opencode/instructions.md — all generated from
                             # .converge/attractor.yml (manual sections preserved)
```

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
      - run: npm install -g convergekit
      - run: converge check --strict --base origin/${{ github.base_ref }}
      - run: converge audit --fresh --no-llm --base origin/${{ github.base_ref }}
```

`error`-severity blockers fail CI; warnings report without failing; advisory findings are recorded only.

## Commands

| Command | Purpose |
|---|---|
| `converge init` | Scaffold `.converge/` + `docs/`, infer boundary-rule drafts from directory layout |
| `converge plan "<title>" --type bugfix\|feature\|refactor` | Create a numbered plan, set it active |
| `converge check [--json] [--strict] [--base <ref>] [--no-exec]` | Full deterministic gate; exit 1 when blocked |
| `converge audit --fresh [--llm claude\|codex] [--no-llm]` | Evidence pack + independent audit |
| `converge close <PLAN-ID> [--force\|--human-approved --reason <r>]` | Close a plan; refuses while blockers exist |
| `converge closure-status [PLAN-ID]` | Closure state for CI |
| `converge handoff [--for claude\|codex]` | Cross-session handoff summary |
| `converge memory add --type <type> --summary <s>` | Record a trajectory lesson |
| `converge compile --target claude\|codex\|opencode\|cline [--all]` | Generate agent configs from the attractor |

## Status & roadmap

v0.1 (this release): product mode, JS/TS boundary checking, the full closure loop, Claude/Codex/OpenCode/Cline compilation. See [ConvergeKit_PRD_v0.1.md](ConvergeKit_PRD_v0.1.md) for the full PRD, including v0.2+ (GitHub Action package, holdout tests, Python via import-linter, MCP server) and v0.3+ (research / venture modes).

## Development

```bash
npm install
npm run build     # tsc → dist/
npm test          # vitest: unit + end-to-end on a temp git fixture
bash scripts/demo.sh
```

MIT license.
