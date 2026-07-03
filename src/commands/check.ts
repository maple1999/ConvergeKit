import path from "node:path";
import { loadAttractor } from "../lib/config.js";
import { findRepoRoot, writeFileSafe } from "../lib/paths.js";
import {
  currentCommit,
  getDiffSummary,
  getStatusSnapshot,
  isGitRepo,
  resolveBaseRef,
  resolveConfigRef,
} from "../lib/git.js";
import { getActivePlanId, parsePlan, updatePlanStatus } from "../lib/plans.js";
import {
  CheckReport,
  computeClosure,
  renderCheckMarkdown,
} from "../lib/report.js";
import { checkForbiddenPaths } from "../checks/forbiddenPath.js";
import { checkDependencyDirection } from "../checks/boundary.js";
import { checkDiffScope } from "../checks/diffScope.js";
import { checkTestIntegrity, type TestIntegrityMode } from "../checks/testIntegrity.js";
import { checkAntiPatterns } from "../checks/antiPattern.js";
import { checkConfigIntegrity } from "../checks/configIntegrity.js";
import { compareWorkingTreeSnapshots } from "../checks/sideEffects.js";
import { runVerification } from "../checks/verification.js";

export interface CheckOptions {
  plan?: string;
  json?: boolean;
  strict?: boolean;
  /** diff base ref; "auto" resolves origin/$GITHUB_BASE_REF in GitHub Actions */
  base?: string;
  /** skip executing verification commands & revert-rerun (fast structural check) */
  noExec?: boolean;
  /** trust boundary: load attractor.yml from this ref instead of the working tree ("auto" supported) */
  configFromBase?: string;
  /** test-revert-rerun execution mode */
  testIntegrityMode?: string;
}

const TEST_INTEGRITY_MODES: TestIntegrityMode[] = ["in-place", "isolated"];

export async function runCheck(opts: CheckOptions): Promise<CheckReport> {
  const root = findRepoRoot();
  if (!isGitRepo(root)) {
    throw new Error(`Not a git repository: ${root}. converge check needs git diff as input.`);
  }
  const base = resolveBaseRef(opts.base);
  const configFromBase = resolveConfigRef(opts.configFromBase);
  const testIntegrityMode = (opts.testIntegrityMode ?? "in-place") as TestIntegrityMode;
  if (!TEST_INTEGRITY_MODES.includes(testIntegrityMode)) {
    throw new Error(
      `invalid --test-integrity-mode "${opts.testIntegrityMode}". Expected in-place | isolated.`
    );
  }

  const cfg = loadAttractor(root, { configFromBase });
  const diff = getDiffSummary(root, base);

  const planId = opts.plan ?? getActivePlanId(root);
  const plan = planId ? parsePlan(root, planId) : null;

  // snapshot the working tree before any command execution (side-effect detection)
  const treeBefore = opts.noExec ? null : getStatusSnapshot(root);

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
      mode: testIntegrityMode,
      setupCommands: cfg.verification?.setup_for_isolated ?? [],
    }),
    ...checkAntiPatterns(root, cfg, diff),
    ...checkConfigIntegrity(diff, { configFromBase }),
  ];

  // working-tree side effects of everything converge executed above
  if (treeBefore) {
    checks.push(compareWorkingTreeSnapshots(treeBefore, getStatusSnapshot(root)));
  }

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
    configSource: configFromBase
      ? `${configFromBase}:.converge/attractor.yml`
      : "working tree",
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
  if (report.status === "blocked") {
    const configModified = report.checks.some(
      (c) => c.id === "attractor-config-modified" && c.result === "failed"
    );
    if (configModified) {
      console.error(
        "\nNote: this diff modifies the attractor config itself — a human must review and approve (converge close --human-approved)."
      );
    }
    console.error(
      'Closure blocked. Run "converge correction" to generate a repair packet for the next agent run.'
    );
    process.exitCode = 1;
  }
}
