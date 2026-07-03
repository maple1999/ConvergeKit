import type { DiffSummary } from "../lib/git.js";
import type { Finding } from "../lib/report.js";

/** Paths that define the closure gate itself. Changing them is not a normal code change. */
const GATE_CONFIG_PATHS = [".converge/attractor.yml"];
const GATE_CONFIG_PREFIXES = [".converge/templates/", ".converge/profiles/"];

export const ATTRACTOR_MODIFIED_ID = "attractor-config-modified";

/**
 * F. Config Integrity Check.
 *
 * The attractor is the closure gate itself, so a diff that edits it (or the
 * templates/profiles it is compiled from) is neither a pass nor a plain
 * failure: it requires a human decision. The finding blocks closure until a
 * human approves via `converge close --human-approved`; the fresh audit maps
 * it to "needs_human_decision" when it is the only blocker.
 */
export function checkConfigIntegrity(
  diff: DiffSummary,
  opts: { configFromBase?: string } = {}
): Finding[] {
  const touched = diff.files.filter(
    (f) =>
      GATE_CONFIG_PATHS.includes(f.path) ||
      GATE_CONFIG_PREFIXES.some((p) => f.path.startsWith(p))
  );
  if (touched.length === 0) {
    return [
      {
        id: ATTRACTOR_MODIFIED_ID,
        severity: "error",
        result: "passed",
        evidence: "attractor config unchanged in this diff",
      },
    ];
  }
  const lines = [
    `${touched.map((t) => t.path).join(", ")} changed in this diff. Attractor changes require human approval.`,
    "Attractor changes modify the closure gate itself; review them, then close with --human-approved.",
  ];
  if (opts.configFromBase) {
    lines.push(
      `authoritative config for this run was loaded from ${opts.configFromBase}, not from the working tree.`
    );
  }
  return [
    {
      id: ATTRACTOR_MODIFIED_ID,
      severity: "error",
      result: "failed",
      evidence: lines.join("\n"),
    },
  ];
}
