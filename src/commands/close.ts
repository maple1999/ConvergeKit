import fs from "node:fs";
import path from "node:path";
import { loadAttractor } from "../lib/config.js";
import { findRepoRoot, readFileIfExists, toRepoRel, writeFileSafe } from "../lib/paths.js";
import { resolveConfigRef } from "../lib/git.js";
import { parsePlan, setActivePlan, updatePlanStatus } from "../lib/plans.js";
import type { AuditJudgment } from "./audit.js";
import type { CheckReport } from "../lib/report.js";
import { generateHandoff } from "./handoff.js";

export interface CloseOptions {
  force?: boolean;
  humanApproved?: boolean;
  reason?: string;
  /** trust boundary: load closure policy from this ref instead of the working tree ("auto" supported) */
  configFromBase?: string;
}

/**
 * Closure state machine:
 * Draft → Active → Implemented → Checked → Audited → Closed
 * failure branches: Blocked | Needs Human Decision | Needs Rework
 *
 * Closure requires (per attractor.yml closure config):
 * - active plan exists, exit criteria checked
 * - converge check passed (fresh report, no blockers)
 * - fresh audit judgment = closed
 * - verification evidence executed by converge
 */
export async function closeCommand(planId: string, opts: CloseOptions): Promise<void> {
  const root = findRepoRoot();
  const cfg = loadAttractor(root, { configFromBase: resolveConfigRef(opts.configFromBase) });
  const plan = parsePlan(root, planId);
  if (!plan) {
    console.error(`Plan ${planId} not found in docs/plans/.`);
    process.exitCode = 1;
    return;
  }

  const reportDir = path.join(root, ".converge", "reports", planId);
  const checkRaw = readFileIfExists(path.join(reportDir, "check.json"));
  const auditRaw = readFileIfExists(path.join(reportDir, "audit.json"));
  const check: CheckReport | null = checkRaw ? JSON.parse(checkRaw) : null;
  const audit: AuditJudgment | null = auditRaw ? JSON.parse(auditRaw) : null;

  const blockers: string[] = [];

  if (!check) {
    blockers.push("no converge check report found — run: converge check");
  } else {
    for (const b of check.closure.blockers) blockers.push(`converge check: ${b}`);
    const requiredEvidence = check.behaviorEvidence.filter((e) => e.required);
    for (const ev of requiredEvidence) {
      if (!ev.executed) blockers.push(`verification "${ev.id}" was never executed by converge`);
      else if (ev.exitCode !== 0) blockers.push(`verification "${ev.id}" failed (exit ${ev.exitCode})`);
    }
  }

  if (cfg.closure?.require_fresh_audit !== false) {
    if (!audit) {
      blockers.push("no fresh audit found — run: converge audit --fresh");
    } else if (audit.judgment === "not_closed") {
      blockers.push(`fresh audit judgment: Not Closed (${audit.blockers.length} blocker(s))`);
    } else if (audit.judgment === "needs_human_decision" && !opts.humanApproved) {
      blockers.push("fresh audit judgment: Needs Human Decision — re-run with --human-approved");
    }
  }

  if (cfg.closure?.require_plan_exit_criteria !== false) {
    const unchecked = plan.exitCriteria.filter((c) => !c.checked);
    if (plan.exitCriteria.length === 0) {
      blockers.push("plan has no exit criteria defined");
    } else if (unchecked.length > 0) {
      blockers.push(
        `plan exit criteria unchecked: ${unchecked.map((c) => `"${c.text}"`).join(", ")}`
      );
    }
  }

  const overridden = blockers.length > 0 && (opts.force || opts.humanApproved);
  if (blockers.length > 0 && !overridden) {
    console.log(`Cannot close ${planId}.\n`);
    console.log("Blockers:");
    blockers.forEach((b, i) => console.log(`${i + 1}. ${b}`));
    updatePlanStatus(root, planId, "Needs Rework");
    console.log(`\nStatus updated: Needs Rework.`);
    process.exitCode = 1;
    return;
  }

  if (overridden) {
    if (!cfg.closure?.allow_human_override) {
      console.error("human override is disabled by attractor.yml (closure.allow_human_override: false).");
      process.exitCode = 1;
      return;
    }
    const overrideRecord = {
      plan: planId,
      overriddenAt: new Date().toISOString(),
      overriddenBlockers: blockers,
      reason: opts.reason ?? "(no reason given — record one with --reason)",
      humanApproved: !!opts.humanApproved,
      forced: !!opts.force,
    };
    writeFileSafe(
      path.join(reportDir, "closure-override.json"),
      JSON.stringify(overrideRecord, null, 2)
    );
    console.log(`⚠ Closing WITH OVERRIDE. ${blockers.length} blocker(s) recorded in closure-override.json.`);
  }

  updatePlanStatus(root, planId, "Closed");
  setActivePlan(root, null);

  // closure report
  const closureReport = `# Closure Report: ${planId}

- closed at: ${new Date().toISOString()}
- check status: ${check?.status ?? "(missing)"}
- audit judgment: ${audit?.judgment ?? "(missing)"}
- override: ${overridden ? "YES — see closure-override.json" : "no"}

## Evidence

- Check report: .converge/reports/${planId}/check.md
- Audit report: docs/audits/${planId}-fresh-audit.md
- Verification evidence: .converge/reports/${planId}/evidence/
`;
  writeFileSafe(path.join(reportDir, "closure.md"), closureReport);

  // update handoff
  generateHandoff(root, {});

  console.log(`${planId} closed.\n`);
  console.log("Closure evidence:");
  console.log(`- Check report: .converge/reports/${planId}/check.md`);
  console.log(`- Audit report: docs/audits/${planId}-fresh-audit.md`);
  console.log(`- Verification evidence: .converge/reports/${planId}/evidence/`);
  console.log(`- Handoff updated: .converge/handoff.md`);
}

export async function closureStatusCommand(planId?: string): Promise<void> {
  const root = findRepoRoot();
  const id = planId ?? (await import("../lib/plans.js")).getActivePlanId(root);
  if (!id) {
    console.log("No active plan.");
    return;
  }
  const plan = parsePlan(root, id);
  const reportDir = path.join(root, ".converge", "reports", id);
  const check = readFileIfExists(path.join(reportDir, "check.json"));
  const audit = readFileIfExists(path.join(reportDir, "audit.json"));
  console.log(`Plan: ${id}`);
  console.log(`Status: ${plan?.status ?? "(unknown)"}`);
  console.log(`Check report: ${check ? JSON.parse(check).status : "missing"}`);
  console.log(`Fresh audit: ${audit ? JSON.parse(audit).judgment : "missing"}`);
  if (plan && plan.status !== "Closed") process.exitCode = plan?.status === "Audited" ? 0 : 1;
}
