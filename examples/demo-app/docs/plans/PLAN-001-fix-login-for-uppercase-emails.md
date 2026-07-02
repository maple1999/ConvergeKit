# PLAN-001: fix login for uppercase emails

<!-- plan-type: bugfix -->

## Status

Closed

## Current Baseline

Describe current behavior, architecture, known constraints.

## Goal

fix login for uppercase emails

## Non-goals

- `src/db/**`

## Expected Attractor Movement

Which attractor invariants should this plan reinforce?

## Risk Level

Low

## Files / Areas Likely Affected

- ...

## Exit Criteria

- [x] login succeeds with uppercase email
- [x] fix lives in the service layer, not UI

## Validation Checklist

- [ ] lint
- [ ] unit tests
- [ ] focused test
- [ ] typecheck
- [ ] boundary check

## Closure Evidence Required

- git diff
- converge check report
- verification evidence executed by converge
- fresh audit report

## Notes

...
