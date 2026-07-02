import path from "node:path";
import { loadAttractor } from "../lib/config.js";
import { findRepoRoot, writeFileSafe } from "../lib/paths.js";
import { currentCommit, getDiffSummary, isGitRepo } from "../lib/git.js";
import { getActivePlanId, parsePlan, updatePlanStatus } from "../lib/plans.js";
import {
  CheckReport,
  computeClosure,
  renderCheckMarkdown,
} from "../lib/report.js";
import { checkForbiddenPaths } from "../checks/forbiddenPath.js";
import { checkDependencyDirection } from "../checks/boundary.js";
import { checkDiffScope } from "../checks/diffScope.js";
import { checkTestIntegrity } from "../checks/testIntegrity.js";
import { checkAntiPatterns } from "../checks/antiPattern.js";
import { runVerification } from "../checks/verification.js";

export interface CheckOptions {
  plan?: string;
  json?: boolean;
  strict?: boolean;
  base?: string;
  /** skip executing verification commands & revert-rerun (fast structural check) */
  noExec?: boolean;
}

export async function runCheck(opts: CheckOptions): Promise<CheckReport> {
  const root = findRepoRoot();
  if (!isGitRepo(root)) {
    throw new Error(`Not a git repository: ${root}. converge check needs git diff as input.`);
  }
  const cfg = loadAttractor(root);
  const base = opts.base ?? "HEAD";
  const diff = getDiffSummary(root, base);

  const planId = opts.plan ?? getActivePlanId(root);
  const plan = planId ? parsePlan(root, planId) : null;

  // E. verification commands — executed by converge itself
  const behaviorEvidence = runVerification(root, cfg, planId, {
    skipExecution: opts.noExec,
  });
  const testCommand =
    cfg.verification?.before_close?.find((c) => c.id === "test") ?? null;

  const checks = [
    ...checkForbiddenPaths(cfg, diff),
    ...(await checkDependencyDirection(root, cfg, diff)),
    ...checkDiffScope(cfg, diff, plan),
    ...checkTestIntegrity(root, cfg, diff, {
      testCommand,
      runRevertRerun: !opts.noExec,
    }),
    ...checkAntiPatterns(root, cfg, diff),
  ];

  // strict mode: warnings become blockers
  if (opts.strict) {
    for (const c of checks) {
      if (c.result === "warning") {
        c.result = "failed";
        c.severity = "error";
      }
    }
  }

  const partial = {
    plan: planId,
    mode: cfg.mode,
    generatedAt: new Date().toISOString(),
    commit: currentCommit(root),
    diff: {
      base,
      changedFiles: diff.files.length,
      addedLines: diff.totalAdded,
      deletedLines: diff.totalDeleted,
      files: diff.files.map((f) => ({
        path: f.path,
        status: f.status,
        added: f.addedLines,
        deleted: f.deletedLines,
      })),
    },
    behaviorEvidence,
    checks,
  };
  const { status, closure } = computeClosure(partial);
  const report: CheckReport = { ...partial, status, closure };

  // persist reports
  const reportDir = path.join(root, ".converge", "reports", planId ?? "adhoc");
  writeFileSafe(path.join(reportDir, "check.json"), JSON.stringify(report, null, 2));
  writeFileSafe(path.join(reportDir, "check.md"), renderCheckMarkdown(report));

  // plan status transition: Implemented -> Checked when check passes
  if (planId && plan && closure.allowed && ["Active", "Implemented"].includes(plan.status)) {
    updatePlanStatus(root, planId, "Checked");
  }

  return report;
}

export async function checkCommand(opts: CheckOptions): Promise<void> {
  const report = await runCheck(opts);
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderCheckMarkdown(report));
  }
  if (report.status === "blocked") process.exitCode = 1;
}
