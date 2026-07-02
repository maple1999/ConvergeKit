# Evidence Pack: PLAN-001

## Authority levels

- authoritative: everything in this pack (live repo, git diff, check report, verification evidence)
- advisory: any agent-authored summary NOT in this pack

## Repo Metadata

- commit: 73c65fdd83791cb896feaccb62cfe148cfeb9d0a
- branch: master
- generated: 2026-07-02T03:29:04.528Z

## Active Plan

```markdown
# PLAN-001: fix login for uppercase emails

<!-- plan-type: bugfix -->

## Status

Needs Rework

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

```

## Attractor Spec

```yaml
version: 0.1
mode: product # v0.1 supports product only; research | venture planned for v0.3+

project:
  name: demo-app
  mission: "Prevent AI coding agents from drifting project architecture."

authority:
  architecture:
    - docs/architecture/README.md
  decisions:
    - docs/decisions/
  plans:
    - docs/plans/
  audits:
    - docs/audits/

attractor:
  invariants:
    - id: no-test-weakening
      rule: "Tests must not be weakened to match implementation."
      severity: error
      check: test-revert-rerun

  dependency_direction:
    - id: service-cannot-import-ui
      from: "src/service/**"
      cannot_import: "src/ui/**"
      severity: error
    - id: ui-cannot-import-db
      from: "src/ui/**"
      cannot_import: "src/db/**"
      severity: error

  forbidden_paths:
    - path: ".env"
      severity: error
    - path: "secrets/**"
      severity: error

  anti_patterns:
    - id: broad-refactor-during-bugfix
      description: "Broad refactor during bugfix task."
      severity: warning

# Verification commands are EXECUTED BY CONVERGE ITSELF.
# Exit code, output hash and timestamps are recorded as the only
# authoritative validation evidence. Pre-existing logs are advisory only.
verification:
  executed_by: converge
  evidence_dir: ".converge/reports/${plan}/evidence/"
  record: [command, exit_code, output_hash, timestamp]
  before_close:
    - id: test
      command: "npm test"
      required: true

closure:
  require_fresh_audit: true
  require_plan_exit_criteria: true
  require_validation_logs: true
  allow_human_override: true

agent_policy:
  default:
    require_plan_first: false
    require_read_before_edit: true
    block_close_without_audit: true

  bugfix:
    edit_scope: minimal
    require_focused_test: true
    max_diff_lines_warning: 300
    max_diff_lines_blocker: 800

  refactor:
    require_plan_first: true
    require_human_approval_if_diff_over: 500

```

## Converge Check Report (deterministic)

```json
{
  "status": "passed",
  "closure": {
    "allowed": true,
    "blockers": [],
    "warnings": []
  },
  "checks": [
    {
      "id": "forbidden-path:.env",
      "severity": "error",
      "result": "passed",
      "evidence": "no forbidden paths touched"
    },
    {
      "id": "forbidden-path:secrets/**",
      "severity": "error",
      "result": "passed",
      "evidence": "no forbidden paths touched"
    },
    {
      "id": "service-cannot-import-ui",
      "severity": "error",
      "result": "passed",
      "evidence": "no boundary violations in changed files"
    },
    {
      "id": "ui-cannot-import-db",
      "severity": "error",
      "result": "passed",
      "evidence": "no boundary violations in changed files"
    },
    {
      "id": "diff-scope",
      "severity": "warning",
      "result": "passed",
      "evidence": "diff is 16 lines across 3 files"
    },
    {
      "id": "plan-non-goals",
      "severity": "error",
      "result": "passed",
      "evidence": "no non-goal areas touched"
    },
    {
      "id": "test-revert-rerun",
      "severity": "error",
      "result": "passed",
      "evidence": "tests pass with both modified and baseline test files (1 test file(s) checked)"
    },
    {
      "id": "test-heuristics",
      "severity": "advisory",
      "result": "passed",
      "evidence": "test files modified: tests/auth.test.js"
    }
  ],
  "behaviorEvidence": [
    {
      "id": "test",
      "command": "npm test",
      "required": true,
      "executed": true,
      "exitCode": 0,
      "outputHash": "0db1b670c53c652ff36621ee592f3fd54a99f04987a54df7ea19478e41cdedd0",
      "startedAt": "2026-07-02T03:29:02.689Z",
      "durationMs": 540
    }
  ]
}
```

## Git Diff

```diff
diff --git a/docs/plans/PLAN-001-fix-login-for-uppercase-emails.md b/docs/plans/PLAN-001-fix-login-for-uppercase-emails.md
index d1b103a..b918020 100644
--- a/docs/plans/PLAN-001-fix-login-for-uppercase-emails.md
+++ b/docs/plans/PLAN-001-fix-login-for-uppercase-emails.md
@@ -4,7 +4,7 @@
 
 ## Status
 
-Active
+Needs Rework
 
 ## Current Baseline
 
@@ -16,9 +16,7 @@ fix login for uppercase emails
 
 ## Non-goals
 
-List what must not change. Path bullets (e.g. `src/db/**`) are enforced by converge check.
-
-- ...
+- `src/db/**`
 
 ## Expected Attractor Movement
 
@@ -34,7 +32,8 @@ Low
 
 ## Exit Criteria
 
-- [ ] ...
+- [x] login succeeds with uppercase email
+- [x] fix lives in the service layer, not UI
 
 ## Validation Checklist
 
diff --git a/src/service/auth.js b/src/service/auth.js
index 6fa1433..8aff846 100644
--- a/src/service/auth.js
+++ b/src/service/auth.js
@@ -1,9 +1,8 @@
 // Service layer — business logic. UI must go through this layer.
 import { getUserByEmail } from "../db/client.js";
 
-// BUG: lookup is case-sensitive, so "Alice@Example.com" fails to log in.
 export function login(email, password) {
-  const user = getUserByEmail(email);
+  const user = getUserByEmail(email.toLowerCase());
   if (!user || user.password !== password) {
     return { ok: false };
   }
diff --git a/tests/auth.test.js b/tests/auth.test.js
index f1b5242..a7e65b7 100644
--- a/tests/auth.test.js
+++ b/tests/auth.test.js
@@ -9,3 +9,7 @@ test("login succeeds with correct credentials", () => {
 test("login fails with wrong password", () => {
   assert.equal(renderLogin("alice@example.com", "nope"), "Login failed.");
 });
+
+test("login succeeds with uppercase email", () => {
+  assert.equal(renderLogin("Alice@Example.com", "wonderland"), "Welcome, Alice!");
+});

```

## Architecture Docs

### docs/architecture/README.md

# Architecture

Describe the long-term architecture this repo should converge to.

- Layers and their responsibilities
- Allowed dependency directions
- Quality standards

This document is part of the ConvergeKit authority chain (see .converge/attractor.yml).


## Related Memory Records

(none)
