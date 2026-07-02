export const PLAN_TEMPLATE = (num: string, title: string, type: string) => `# PLAN-${num}: ${title}

<!-- plan-type: ${type} -->

## Status

Active

## Current Baseline

Describe current behavior, architecture, known constraints.

## Goal

${title}

## Non-goals

List what must not change. Path bullets (e.g. \`src/db/**\`) are enforced by converge check.

- ...

## Expected Attractor Movement

Which attractor invariants should this plan reinforce?

## Risk Level

Low

## Files / Areas Likely Affected

- ...

## Exit Criteria

- [ ] ...

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
`;

export const MEMORY_TEMPLATE = (type: string) => `# Memory: ${type}

## Summary

## Context

## What Was Assumed

## What Disproved It

## Evidence

## Future Instruction

## Related Plans

## Created At

${new Date().toISOString()}
`;

export const STARTER_ATTRACTOR = (opts: {
  projectName: string;
  inferredDeps: { id: string; from: string; cannot_import: string }[];
  hasNpm: boolean;
}) => {
  const deps =
    opts.inferredDeps.length > 0
      ? opts.inferredDeps
          .map(
            (d) => `    - id: ${d.id}
      from: "${d.from}"
      cannot_import: "${d.cannot_import}"
      severity: error`
          )
          .join("\n")
      : `    # - id: ui-cannot-import-db
    #   from: "src/ui/**"
    #   cannot_import: "src/db/**"
    #   severity: error`;

  const verification = opts.hasNpm
    ? `    - id: lint
      command: "npm run lint"
      required: false
    - id: test
      command: "npm test"
      required: true
    - id: typecheck
      command: "npm run typecheck"
      required: false`
    : `    # - id: test
    #   command: "<your test command>"
    #   required: true`;

  return `version: 0.1
mode: product # v0.1 supports product only; research | venture planned for v0.3+

project:
  name: ${opts.projectName}
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
${deps}

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
  evidence_dir: ".converge/reports/\${plan}/evidence/"
  record: [command, exit_code, output_hash, timestamp]
  before_close:
${verification}

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
`;
};

export const ARCHITECTURE_README = `# Architecture

Describe the long-term architecture this repo should converge to.

- Layers and their responsibilities
- Allowed dependency directions
- Quality standards

This document is part of the ConvergeKit authority chain (see .converge/attractor.yml).
`;

export const HANDOFF_HEADER = `# ConvergeKit Handoff
`;
