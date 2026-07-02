import picomatch from "picomatch";
import type { AttractorConfig } from "../lib/config.js";
import type { DiffSummary } from "../lib/git.js";
import type { PlanInfo } from "../lib/plans.js";
import type { Finding } from "../lib/report.js";

/** C. Diff Scope Check — is the change size/area appropriate for the plan type? */
export function checkDiffScope(
  cfg: AttractorConfig,
  diff: DiffSummary,
  plan: PlanInfo | null
): Finding[] {
  const findings: Finding[] = [];
  const planType = plan?.type ?? "default";
  const policy = cfg.agent_policy?.[planType] ?? cfg.agent_policy?.default ?? {};

  const totalLines = diff.totalAdded + diff.totalDeleted;
  const warnAt = policy.max_diff_lines_warning ?? (planType === "bugfix" ? 300 : undefined);
  const blockAt = policy.max_diff_lines_blocker ?? (planType === "bugfix" ? 800 : undefined);

  if (blockAt !== undefined && totalLines > blockAt) {
    findings.push({
      id: "diff-scope",
      severity: "error",
      result: "failed",
      evidence: `diff is ${totalLines} lines, exceeds blocker threshold ${blockAt} for plan type "${planType}"`,
    });
  } else if (warnAt !== undefined && totalLines > warnAt) {
    findings.push({
      id: "diff-scope",
      severity: "warning",
      result: "warning",
      evidence: `diff is ${totalLines} lines, broad change for plan type "${planType}" (warning threshold ${warnAt})`,
    });
  } else {
    findings.push({
      id: "diff-scope",
      severity: "warning",
      result: "passed",
      evidence: `diff is ${totalLines} lines across ${diff.files.length} files`,
    });
  }

  // Non-goal area check: touching areas the plan explicitly declared off-limits is a blocker.
  if (plan && plan.nonGoalPaths.length > 0) {
    const violations: string[] = [];
    for (const ng of plan.nonGoalPaths) {
      const isMatch = picomatch(ng, { dot: true });
      for (const f of diff.files) {
        if (isMatch(f.path) || f.path === ng || f.path.startsWith(ng.replace(/\/?\**$/, "") + "/")) {
          violations.push(`${f.path} (non-goal: ${ng})`);
        }
      }
    }
    findings.push({
      id: "plan-non-goals",
      severity: "error",
      result: violations.length > 0 ? "failed" : "passed",
      evidence:
        violations.length > 0
          ? `changes touch plan non-goal areas:\n${[...new Set(violations)].join("\n")}`
          : "no non-goal areas touched",
    });
  }

  return findings;
}
