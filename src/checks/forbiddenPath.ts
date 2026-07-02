import picomatch from "picomatch";
import type { AttractorConfig } from "../lib/config.js";
import type { DiffSummary } from "../lib/git.js";
import type { Finding } from "../lib/report.js";

/** A. Forbidden Path Check — flag any change touching a forbidden path. */
export function checkForbiddenPaths(cfg: AttractorConfig, diff: DiffSummary): Finding[] {
  const rules = cfg.attractor?.forbidden_paths ?? [];
  const findings: Finding[] = [];
  for (const rule of rules) {
    const isMatch = picomatch(rule.path, { dot: true });
    const hits = diff.files.filter((f) => isMatch(f.path) || f.path === rule.path);
    findings.push({
      id: `forbidden-path:${rule.path}`,
      severity: rule.severity ?? "error",
      result: hits.length > 0 ? "failed" : "passed",
      evidence:
        hits.length > 0
          ? `modified forbidden path(s): ${hits.map((h) => h.path).join(", ")}`
          : "no forbidden paths touched",
    });
  }
  return findings;
}
