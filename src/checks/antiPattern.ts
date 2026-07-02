import fs from "node:fs";
import path from "node:path";
import type { AttractorConfig } from "../lib/config.js";
import type { DiffSummary } from "../lib/git.js";
import type { Finding } from "../lib/report.js";

/** P1 (advisory): anti-pattern regex scan over changed files that declare a pattern. */
export function checkAntiPatterns(
  root: string,
  cfg: AttractorConfig,
  diff: DiffSummary
): Finding[] {
  const patterns = (cfg.attractor?.anti_patterns ?? []).filter((p) => p.pattern);
  const findings: Finding[] = [];
  for (const ap of patterns) {
    let re: RegExp;
    try {
      re = new RegExp(ap.pattern!, "m");
    } catch {
      findings.push({
        id: `anti-pattern:${ap.id ?? ap.description}`,
        severity: "advisory",
        result: "skipped",
        evidence: `invalid regex: ${ap.pattern}`,
      });
      continue;
    }
    const hits: string[] = [];
    for (const f of diff.files) {
      if (f.status === "D") continue;
      const abs = path.join(root, f.path);
      try {
        if (re.test(fs.readFileSync(abs, "utf8"))) hits.push(f.path);
      } catch {
        /* binary or unreadable */
      }
    }
    findings.push({
      id: `anti-pattern:${ap.id ?? ap.description}`,
      severity: ap.severity ?? "advisory",
      result: hits.length > 0 ? "advisory" : "passed",
      evidence:
        hits.length > 0
          ? `${ap.description}\nmatched in: ${hits.join(", ")}`
          : "not detected",
    });
  }
  return findings;
}
