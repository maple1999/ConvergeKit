import picomatch from "picomatch";
import type { AttractorConfig } from "../lib/config.js";
import type { DiffSummary } from "../lib/git.js";
import type { Finding } from "../lib/report.js";

/**
 * A. Forbidden Path Check — flag any change touching a forbidden path.
 *
 * Covers both the tracked diff and untracked (non-ignored) files: `git diff`
 * never lists untracked files, but an agent-created `.env` must still block
 * closure. Files matched by .gitignore are not scanned (known boundary).
 */
export function checkForbiddenPaths(
  cfg: AttractorConfig,
  diff: DiffSummary,
  untrackedFiles: string[] = []
): Finding[] {
  const rules = cfg.attractor?.forbidden_paths ?? [];
  const findings: Finding[] = [];
  for (const rule of rules) {
    const isMatch = picomatch(rule.path, { dot: true });
    const diffHits = diff.files
      .filter((f) => isMatch(f.path) || f.path === rule.path)
      .map((f) => f.path);
    const untrackedHits = untrackedFiles.filter((p) => isMatch(p) || p === rule.path);
    const evidence: string[] = [];
    if (diffHits.length > 0) evidence.push(`modified forbidden path(s): ${diffHits.join(", ")}`);
    if (untrackedHits.length > 0) {
      evidence.push(`untracked forbidden file(s) present: ${untrackedHits.join(", ")}`);
    }
    findings.push({
      id: `forbidden-path:${rule.path}`,
      severity: rule.severity ?? "error",
      result: evidence.length > 0 ? "failed" : "passed",
      evidence: evidence.length > 0 ? evidence.join("\n") : "no forbidden paths touched",
    });
  }
  return findings;
}
