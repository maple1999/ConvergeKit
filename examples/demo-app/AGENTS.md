<!-- convergekit:generated:start -->
# ConvergeKit Project Guidance

Generated from .converge/attractor.yml — edit that file, then run `converge compile --target codex`.

## Authority

- architecture: `docs/architecture/README.md`
- decisions: `docs/decisions/`
- plans: `docs/plans/`
- audits: `docs/audits/`

## Current Attractor

- **no-test-weakening** (error): Tests must not be weakened to match implementation.
- **service-cannot-import-ui** (error): `src/service/**` must NOT import `src/ui/**`
- **ui-cannot-import-db** (error): `src/ui/**` must NOT import `src/db/**`
- **forbidden path** (error): do not modify `.env`
- **forbidden path** (error): do not modify `secrets/**`

## Plan Protocol

Create a plan before non-trivial work: `converge plan "<title>"`.
Respect plan non-goals. Keep bugfix diffs minimal.

## Closure Protocol

A task is NOT complete when tests pass. It is complete when `converge close <PLAN_ID>` succeeds.
Closure evidence comes only from commands executed by converge itself.

## Validation Commands

- `npm test` (required)

## Prohibited Shortcuts

- Broad refactor during bugfix task.
- Never weaken tests to make them pass (detected by test-revert-rerun).
- Never edit forbidden paths.

## Use ConvergeKit

Before claiming completion, run or request:
- converge check
- converge audit --fresh
- converge close <PLAN_ID>
<!-- convergekit:generated:end -->
