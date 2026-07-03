import path from "node:path";
import { loadAttractor, type AttractorConfig } from "../lib/config.js";
import { findRepoRoot, readFileIfExists, toRepoRel, writeFileSafe } from "../lib/paths.js";
import { getActivePlanId } from "../lib/plans.js";
import { ATTRACTOR_MODIFIED_ID } from "../checks/configIntegrity.js";
import type { AuditJudgment } from "./audit.js";
import type { CheckReport, Finding } from "../lib/report.js";

export interface CorrectionOptions {
  plan?: string;
  /** claude | codex — adjusts framing only; facts stay identical */
  for?: string;
  json?: boolean;
}

/**
 * Correction Packet: convert a blocked check/audit into structured repair
 * instructions for the next agent run. Blocking alone leaves the user to
 * copy-paste check.md into the agent; this packet is the productized loop:
 * blocked closure → converge correction → agent repairs → re-check.
 */
export async function correctionCommand(opts: CorrectionOptions): Promise<void> {
  const root = findRepoRoot();
  const planId = opts.plan ?? getActivePlanId(root);
  const reportDir = path.join(root, ".converge", "reports", planId ?? "adhoc");

  const checkRaw = readFileIfExists(path.join(reportDir, "check.json"));
  if (!checkRaw) {
    throw new Error(
      `No check report found for ${planId ?? "adhoc"} (${toRepoRel(root, path.join(reportDir, "check.json"))}). Run "converge check" first.`
    );
  }
  const check: CheckReport = JSON.parse(checkRaw);
  const auditRaw = readFileIfExists(path.join(reportDir, "audit.json"));
  const audit: AuditJudgment | null = auditRaw ? JSON.parse(auditRaw) : null;

  let cfg: AttractorConfig | null = null;
  try {
    cfg = loadAttractor(root);
  } catch {
    /* correction still works without a readable attractor; repair hints degrade */
  }

  const packet = buildCorrectionPacket(check, audit, cfg, planId, opts.for);
  const file = path.join(reportDir, "correction.md");
  writeFileSafe(file, packet.md);
  if (opts.json) {
    writeFileSafe(path.join(reportDir, "correction.json"), JSON.stringify(packet.json, null, 2));
  }

  console.log(packet.md);
  console.error(`\nCorrection packet written: ${toRepoRel(root, file)}`);
  if (packet.json.status !== "blocked") {
    console.error("Note: closure is not blocked — proceed with converge close.");
  }
}

interface RepairItem {
  finding: string;
  rule: string;
  evidence: string;
  repair: string;
}

export function buildCorrectionPacket(
  check: CheckReport,
  audit: AuditJudgment | null,
  cfg: AttractorConfig | null,
  planId: string | null,
  agent?: string
): { md: string; json: Record<string, unknown> } {
  const failedFindings = check.checks.filter((c) => c.result === "failed");
  const failedVerification = check.behaviorEvidence.filter(
    (e) => e.required && (!e.executed || e.exitCode !== 0)
  );
  const auditBlockers = audit?.blockers ?? [];
  const blocked =
    !check.closure.allowed ||
    (audit !== null && audit.judgment !== "closed");

  const items: RepairItem[] = failedFindings.map((f) => ({
    finding: f.id,
    rule: ruleText(f, cfg),
    evidence: f.evidence,
    repair: repairDirection(f, cfg),
  }));
  for (const ev of failedVerification) {
    items.push({
      finding: `verification:${ev.id}`,
      rule: `required verification command must pass: ${ev.command}`,
      evidence: ev.executed
        ? `exit code ${ev.exitCode} (executed by converge at ${ev.startedAt})`
        : "never executed by converge",
      repair: `Fix the code until \`${ev.command}\` passes. Do not edit the command or fabricate its output.`,
    });
  }

  const verificationCmds = (cfg?.verification?.before_close ?? []).map((c) => c.command);
  const requiredCommands = [
    ...verificationCmds,
    "converge check",
    "converge audit --fresh",
  ];

  const doNot = [
    "Do not delete or weaken tests to pass (detected by test-revert-rerun).",
    "Do not modify .converge/attractor.yml to remove the rule that blocked you.",
    "Do not broaden the fix into an unrelated refactor.",
    `Do not declare completion until \`converge close ${planId ?? "<PLAN-ID>"}\` passes.`,
    ...(cfg?.attractor?.anti_patterns ?? []).map((a) => `Do not: ${a.description}`),
  ];

  const humanDecision =
    audit?.judgment === "needs_human_decision" ||
    failedFindings.some((f) => f.id === ATTRACTOR_MODIFIED_ID);

  const forLine =
    agent === "claude"
      ? "> For Claude Code: this packet is authoritative feedback from ConvergeKit. Follow it before your own plan; do not summarize it away.\n"
      : agent === "codex"
        ? "> For Codex: this packet is authoritative feedback from ConvergeKit. Follow it before your own plan; do not summarize it away.\n"
        : "";

  const md = `# ConvergeKit Correction Packet

${forLine}## Closure Status

${blocked ? "Blocked." : "Not blocked — proceed with converge close."}
${humanDecision ? "\nA human decision is required: the attractor config itself was changed. Either revert that change or ask a human to approve with `converge close --human-approved`.\n" : ""}
## Why blocked

${
  blocked
    ? items.length > 0
      ? "The patch violates the project attractor or its verification requirements:"
      : "The fresh audit judged this plan not closed (see audit blockers below)."
    : "(nothing to fix)"
}

${items
  .map(
    (it) => `## Violated: \`${it.finding}\`

**Rule**: ${it.rule}

**Evidence**:
${it.evidence
  .split("\n")
  .map((l) => `- ${l}`)
  .join("\n")}

**Allowed repair direction**: ${it.repair}`
  )
  .join("\n\n")}

${
  auditBlockers.length > 0
    ? `## Fresh Audit Blockers

${auditBlockers.map((b, i) => `${i + 1}. ${b}`).join("\n")}
`
    : ""
}## Required Next Step

${
  blocked
    ? `Revise the patch so the original goal is preserved but every violation above is resolved. Keep the diff minimal and inside the plan scope.`
    : `Run \`converge close ${planId ?? "<PLAN-ID>"}\`.`
}

## Required Verification

Run, in order:

\`\`\`bash
${requiredCommands.join("\n")}
\`\`\`

## Do Not

${doNot.map((d) => `- ${d}`).join("\n")}

## Minimal Next Prompt

Copy-paste this to ${agent === "codex" ? "Codex" : agent === "claude" ? "Claude Code" : "your agent"} together with the packet above:

\`\`\`text
Use the ConvergeKit Correction Packet above as authoritative feedback.
Revise the current patch so the original plan goal is preserved, but every blocker is resolved.
Do not modify .converge/attractor.yml. Do not weaken tests.
After patching, run:
${requiredCommands.map((c) => `  ${c}`).join("\n")}
  converge close ${planId ?? "<PLAN-ID>"}
Do not declare completion until converge close succeeds.
\`\`\`
`;

  const json = {
    plan: planId,
    generatedAt: check.generatedAt,
    status: blocked ? "blocked" : "closable",
    needsHumanDecision: humanDecision,
    violations: items,
    auditJudgment: audit?.judgment ?? null,
    auditBlockers,
    requiredCommands,
    doNot,
  };
  return { md, json };
}

/** Human-readable rule text for a failed finding, resolved from the attractor when possible. */
function ruleText(f: Finding, cfg: AttractorConfig | null): string {
  const dep = cfg?.attractor?.dependency_direction?.find(
    (d) => (d.id ?? `dep:${d.from}->!${d.cannot_import}`) === f.id
  );
  if (dep) return `\`${dep.from}\` must NOT import \`${dep.cannot_import}\``;
  const inv = cfg?.attractor?.invariants?.find((i) => i.id === f.id);
  if (inv) return inv.rule;
  if (f.id.startsWith("forbidden-path:"))
    return `forbidden path must not be modified: ${f.id.slice("forbidden-path:".length)}`;
  switch (f.id) {
    case "test-revert-rerun":
      return "the implementation must pass the baseline tests, not only tests adapted to it";
    case "test-revert-restore":
      return "test-revert-rerun must leave the working tree exactly as it found it";
    case "working-tree-side-effects":
      return "verification/test commands must not leave the working tree dirty";
    case "diff-scope":
      return "the diff must stay within the size budget for the plan type";
    case "plan-non-goals":
      return "the diff must not touch areas the plan declared as non-goals";
    case ATTRACTOR_MODIFIED_ID:
      return "changes to the attractor config require human approval";
    default:
      return f.id;
  }
}

/** Concrete, directionally-safe repair guidance per finding type. */
function repairDirection(f: Finding, cfg: AttractorConfig | null): string {
  const dep = cfg?.attractor?.dependency_direction?.find(
    (d) => (d.id ?? `dep:${d.from}->!${d.cannot_import}`) === f.id
  );
  if (dep) {
    return `Move the logic behind an allowed boundary so \`${dep.from}\` no longer imports \`${dep.cannot_import}\` (e.g. route through a service/API layer). Keep the original fix's behavior.`;
  }
  if (f.id.startsWith("forbidden-path:")) {
    return `Revert all changes under \`${f.id.slice("forbidden-path:".length)}\` and implement the change elsewhere.`;
  }
  if (f.id.startsWith("anti-pattern:")) {
    return "Remove the flagged pattern; solve the problem the way the attractor describes.";
  }
  switch (f.id) {
    case "test-revert-rerun":
      return "Restore the original test expectations from the diff base, then fix the implementation until those baseline tests pass. Never adapt tests to the implementation.";
    case "test-revert-restore":
      return "Restore the listed test files from git (git checkout -- <file>), verify the working tree is clean of unexpected changes, then re-run converge check.";
    case "working-tree-side-effects":
      return "Make the test command clean up its outputs, add generated files to .gitignore, or run converge check with --test-integrity-mode isolated.";
    case "diff-scope":
      return "Split unrelated changes out of this plan; reduce the diff to the minimal fix.";
    case "plan-non-goals":
      return "Revert every change inside the plan's non-goal areas; if they are genuinely needed, update the plan first and get it re-approved.";
    case ATTRACTOR_MODIFIED_ID:
      return "Revert the changes to .converge/attractor.yml (and templates/profiles), or stop and ask a human to review and approve them with converge close --human-approved.";
    default:
      return "Resolve the evidence above without weakening any rule or test.";
  }
}
