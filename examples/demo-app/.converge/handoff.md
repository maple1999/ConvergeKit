# ConvergeKit Handoff

Generated: 2026-07-02T10:58:37.262Z

## Current Attractor Summary

Mission: Prevent AI coding agents from drifting project architecture.

- no-test-weakening: Tests must not be weakened to match implementation.
- service-cannot-import-ui: src/service/** must not import src/ui/**
- ui-cannot-import-db: src/ui/** must not import src/db/**

## Active Plans

(none)

## Last Closed Plans

- PLAN-001: fix login for uppercase emails

## Open Risks

(none recorded)

## Recent Audit Findings

- PLAN-001-fresh-audit.md: Closed.

## Disproven Assumptions

- Fixing login in the UI layer looks harmless but violates ui-cannot-import-db (.converge/memory/disproven-assumptions/2026-07-02-fixing-login-in-the-ui-layer-looks-harmless-but-violates-ui-.md)

## Divergent Paths

(none)

## Overturned Closures

(none)

## Terminology Traps

(none)

## Recommended Next Step

No active plan. Create one with: converge plan "<title>"

## Agent Instructions

Read CLAUDE.md. Before claiming completion run: converge check, converge audit --fresh, converge close <PLAN_ID>. Do not weaken tests. Do not touch non-goal areas.
