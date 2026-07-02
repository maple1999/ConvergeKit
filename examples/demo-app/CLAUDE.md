# My manual notes

Keep this.

<!-- convergekit:generated:start -->
# Project ConvergeKit Rules

This section is generated from .converge/attractor.yml.
Do not edit generated sections manually. Edit .converge/attractor.yml and run `converge compile --target claude`.

## Project Mission

Prevent AI coding agents from drifting project architecture.

## Authority Order

- architecture: `docs/architecture/README.md`
- decisions: `docs/decisions/`
- plans: `docs/plans/`
- audits: `docs/audits/`

## Attractor Invariants

- **no-test-weakening** (error): Tests must not be weakened to match implementation.
- **service-cannot-import-ui** (error): `src/service/**` must NOT import `src/ui/**`
- **ui-cannot-import-db** (error): `src/ui/**` must NOT import `src/db/**`
- **forbidden path** (error): do not modify `.env`
- **forbidden path** (error): do not modify `secrets/**`

## Anti-patterns

- Broad refactor during bugfix task.

## Plan / Closure Protocol

- Create a plan before non-trivial work: `converge plan "<title>"`
- After implementing: `converge check` → `converge audit --fresh` → `converge close <PLAN_ID>`
- Closure evidence comes ONLY from commands executed by converge; your summary is advisory.
- Never weaken tests: test file changes trigger test-revert-rerun.

## Required Commands

- `npm test` (required)

## When To Use ConvergeKit Skills

- converge-plan: at the start of any non-trivial task
- converge-check: after making changes, before declaring done
- converge-audit: when a task implementation appears complete
- converge-close: to formally close a plan
<!-- convergekit:generated:end -->
