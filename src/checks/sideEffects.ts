import type { Finding } from "../lib/report.js";

/**
 * Working-tree side-effect check: compare `git status --porcelain` snapshots
 * taken before and after converge executed verification commands and
 * test-revert-rerun. Test commands that generate snapshots/coverage/cache
 * files, or worse, silently revert user changes, must not go unreported.
 *
 * Paths under .converge/ are ConvergeKit's own outputs (reports, evidence,
 * state) and are excluded from the comparison.
 */
export function compareWorkingTreeSnapshots(
  before: Map<string, string>,
  after: Map<string, string>
): Finding {
  const ignored = (p: string) => p.startsWith(".converge/");
  const appeared: string[] = [];
  const changed: string[] = [];
  const disappeared: string[] = [];

  for (const [p, xy] of after) {
    if (ignored(p)) continue;
    const prev = before.get(p);
    if (prev === undefined) appeared.push(p);
    else if (prev !== xy) changed.push(`${p} (${prev.trim() || "?"} -> ${xy.trim() || "?"})`);
  }
  for (const p of before.keys()) {
    if (ignored(p)) continue;
    if (!after.has(p)) disappeared.push(p);
  }

  if (appeared.length === 0 && changed.length === 0 && disappeared.length === 0) {
    return {
      id: "working-tree-side-effects",
      severity: "warning",
      result: "passed",
      evidence: "verification/test commands left no side effects in the working tree",
    };
  }

  const lines: string[] = ["verification/test commands left the working tree dirty:"];
  if (appeared.length) lines.push(`new files: ${appeared.join(", ")}`);
  if (changed.length) lines.push(`status changed: ${changed.join(", ")}`);
  if (disappeared.length) {
    lines.push(
      `entries no longer dirty (uncommitted changes may have been LOST): ${disappeared.join(", ")}`
    );
  }
  lines.push(
    "add generated outputs to .gitignore, clean them up in the test command, or use --test-integrity-mode isolated"
  );

  // losing user changes is a blocker; leftover generated files are a warning
  const lost = disappeared.length > 0;
  return {
    id: "working-tree-side-effects",
    severity: lost ? "error" : "warning",
    result: lost ? "failed" : "warning",
    evidence: lines.join("\n"),
  };
}
