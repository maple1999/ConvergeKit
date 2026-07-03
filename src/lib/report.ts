export type Severity = "error" | "warning" | "advisory";
export type CheckResult = "passed" | "failed" | "warning" | "advisory" | "skipped";

export interface Finding {
  id: string;
  severity: Severity;
  result: CheckResult;
  evidence: string;
}

export interface EvidenceRecord {
  id: string;
  command: string;
  required: boolean;
  executed: boolean;
  exitCode: number | null;
  outputHash: string | null;
  startedAt: string | null;
  durationMs: number | null;
}

export interface CheckReport {
  status: "passed" | "warnings" | "blocked";
  plan: string | null;
  mode: string;
  generatedAt: string;
  commit: string;
  /** where attractor.yml was loaded from: "working tree" or "<ref>:.converge/attractor.yml" */
  configSource: string;
  diff: {
    base: string;
    changedFiles: number;
    addedLines: number;
    deletedLines: number;
    files: { path: string; status: string; added: number; deleted: number }[];
  };
  behaviorEvidence: EvidenceRecord[];
  checks: Finding[];
  closure: { allowed: boolean; blockers: string[]; warnings: string[] };
}

export function computeClosure(report: Omit<CheckReport, "closure" | "status">): {
  status: CheckReport["status"];
  closure: CheckReport["closure"];
} {
  const blockers: string[] = [];
  const warnings: string[] = [];
  for (const f of report.checks) {
    if (f.result === "failed" && f.severity === "error") {
      blockers.push(`${f.id}: ${f.evidence.split("\n")[0]}`);
    } else if (f.result === "failed" || f.result === "warning") {
      warnings.push(`${f.id}: ${f.evidence.split("\n")[0]}`);
    }
  }
  for (const ev of report.behaviorEvidence) {
    if (ev.required && (!ev.executed || ev.exitCode !== 0)) {
      blockers.push(
        ev.executed
          ? `verification "${ev.id}" failed (exit ${ev.exitCode})`
          : `required verification "${ev.id}" not executed`
      );
    }
  }
  const status = blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warnings" : "passed";
  return { status, closure: { allowed: blockers.length === 0, blockers, warnings } };
}

export function renderCheckMarkdown(r: CheckReport): string {
  const lines: string[] = [];
  lines.push(`# Converge Check Report`);
  lines.push("");
  lines.push(`- Plan: ${r.plan ?? "(no active plan)"}`);
  lines.push(`- Mode: ${r.mode}`);
  lines.push(`- Commit: ${r.commit}`);
  lines.push(`- Config: ${r.configSource}`);
  lines.push(`- Generated: ${r.generatedAt}`);
  lines.push("");
  lines.push(`## Behavior Evidence (executed by converge)`);
  lines.push("");
  if (r.behaviorEvidence.length === 0) {
    lines.push("- (no verification commands configured)");
  }
  for (const ev of r.behaviorEvidence) {
    if (!ev.executed) {
      lines.push(`- ${ev.id}: not run (${ev.required ? "required → blocker" : "optional"})`);
    } else {
      const ok = ev.exitCode === 0 ? "passed" : `FAILED (exit ${ev.exitCode})`;
      lines.push(
        `- ${ev.id}: ${ok}, evidence recorded (hash ${ev.outputHash?.slice(0, 12)}, ${ev.durationMs}ms)`
      );
    }
  }
  lines.push("");
  lines.push(`## Attractor Checks`);
  lines.push("");
  for (const f of r.checks) {
    const tag = f.result.toUpperCase();
    lines.push(`- ${f.id}: ${tag}${f.severity === "advisory" ? " (advisory)" : ""}`);
    if (f.result !== "passed" && f.result !== "skipped") {
      for (const line of f.evidence.split("\n")) lines.push(`  ${line}`);
    }
  }
  lines.push("");
  lines.push(`## Plan Scope`);
  lines.push("");
  lines.push(`- diff base: ${r.diff.base}`);
  lines.push(`- changed files: ${r.diff.changedFiles}`);
  lines.push(`- diff lines: +${r.diff.addedLines} / -${r.diff.deletedLines}`);
  lines.push("");
  lines.push(`## Closure`);
  lines.push("");
  lines.push(r.closure.allowed ? (r.closure.warnings.length ? "ALLOWED (with warnings)" : "ALLOWED") : "BLOCKED");
  if (r.closure.blockers.length) {
    lines.push("");
    lines.push("Blockers:");
    r.closure.blockers.forEach((b, i) => lines.push(`${i + 1}. ${b}`));
  }
  if (r.closure.warnings.length) {
    lines.push("");
    lines.push("Warnings:");
    r.closure.warnings.forEach((w, i) => lines.push(`${i + 1}. ${w}`));
  }
  lines.push("");
  return lines.join("\n");
}
