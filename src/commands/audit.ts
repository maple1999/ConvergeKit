import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadAttractor } from "../lib/config.js";
import { findRepoRoot, readFileIfExists, writeFileSafe, toRepoRel } from "../lib/paths.js";
import { currentBranch, currentCommit, getDiffText, getDiffSummary } from "../lib/git.js";
import { getActivePlanId, parsePlan, updatePlanStatus } from "../lib/plans.js";
import { runCheck } from "./check.js";
import { runCommand, truncate } from "../lib/exec.js";
import type { CheckReport } from "../lib/report.js";

export interface AuditOptions {
  plan?: string;
  llm?: string; // claude | codex | none
  noLlm?: boolean;
  base?: string;
}

export interface AuditJudgment {
  judgment: "closed" | "not_closed" | "needs_human_decision";
  blockers: string[];
  warnings: string[];
  evidence_reviewed: string[];
  false_positive_risks: string[];
  next_actions: string[];
}

const AUDIT_PROMPT = `# Fresh Audit Task

You are auditing an AI-generated code change.
Do not trust the implementer's completion summary as evidence.
Use only the live repo evidence, git diff, plan, attractor spec, verification evidence, and prior memory.

Your goal is not to confirm completion.
Your goal is to find reasons this plan should not be closed.

Check:
1. Did the implementation satisfy the plan goal?
2. Did it violate non-goals?
3. Did it move the repo away from the attractor?
4. Were tests weakened or coupled to implementation details?
5. Is the verification evidence (executed by converge) sufficient?
6. Is the change scope appropriate?
7. Is a human decision required?

Evidence authority levels:
- authoritative: live repo, git diff, converge check report, verification evidence, plan exit criteria, architecture docs
- advisory: implementation notes, agent final summary, self-reported reasoning

Respond with STRICT JSON only, matching:
{
  "judgment": "closed" | "not_closed" | "needs_human_decision",
  "blockers": string[],
  "warnings": string[],
  "evidence_reviewed": string[],
  "false_positive_risks": string[],
  "next_actions": string[]
}`;

export async function auditCommand(opts: AuditOptions): Promise<AuditJudgment> {
  const root = findRepoRoot();
  const cfg = loadAttractor(root);
  const planId = opts.plan ?? getActivePlanId(root);
  const plan = planId ? parsePlan(root, planId) : null;
  const reportDir = path.join(root, ".converge", "reports", planId ?? "adhoc");

  // 1. deterministic checks first — fresh audit builds on the check report
  console.log("Running converge check (deterministic pass)...");
  const check = await runCheck({ plan: planId ?? undefined, base: opts.base });

  // 2. build evidence pack
  const diffText = getDiffText(root, opts.base ?? "HEAD");
  const evidencePack = buildEvidencePack(root, cfg, planId, plan?.file ?? null, check, diffText);
  writeFileSafe(path.join(reportDir, "evidence-pack.md"), evidencePack.md);
  writeFileSafe(path.join(reportDir, "evidence-pack.json"), JSON.stringify(evidencePack.json, null, 2));
  console.log(`Evidence pack written: ${toRepoRel(root, path.join(reportDir, "evidence-pack.md"))}`);

  // 3. audit
  let judgment: AuditJudgment;
  const useLlm = !opts.noLlm && opts.llm !== "none";
  if (useLlm) {
    const llm = opts.llm ?? "claude";
    console.log(`Running fresh audit with LLM (${llm})...`);
    const llmResult = runLlmAudit(llm, evidencePack.md);
    if (llmResult) {
      judgment = mergeWithDeterministic(llmResult, check);
    } else {
      console.log("LLM unavailable — falling back to no-llm structural audit.");
      judgment = deterministicJudgment(check);
    }
  } else {
    judgment = deterministicJudgment(check);
  }

  // 4. write audit report
  const reportMd = renderAuditReport(planId, judgment, check);
  const auditFile = path.join(root, "docs", "audits", `${planId ?? "adhoc"}-fresh-audit.md`);
  writeFileSafe(auditFile, reportMd);
  writeFileSafe(path.join(reportDir, "audit.json"), JSON.stringify(judgment, null, 2));
  console.log(`Fresh audit report written: ${toRepoRel(root, auditFile)}`);
  console.log(`\nFinal judgment: ${judgment.judgment.replace("_", " ").toUpperCase()}`);
  if (judgment.blockers.length) {
    console.log("Blockers:");
    judgment.blockers.forEach((b, i) => console.log(`  ${i + 1}. ${b}`));
  }

  if (planId && judgment.judgment === "closed") {
    updatePlanStatus(root, planId, "Audited");
  }
  if (judgment.judgment === "not_closed") process.exitCode = 1;
  return judgment;
}

function buildEvidencePack(
  root: string,
  cfg: ReturnType<typeof loadAttractor>,
  planId: string | null,
  planFile: string | null,
  check: CheckReport,
  diffText: string
): { md: string; json: Record<string, unknown> } {
  const planContent = planFile ? readFileIfExists(planFile) : null;
  const attractorRaw = readFileIfExists(path.join(root, ".converge", "attractor.yml"));
  const memory = collectMemory(root);
  const archDocs = (cfg.authority?.architecture ?? [])
    .map((p) => ({ path: p, content: readFileIfExists(path.join(root, p)) }))
    .filter((d) => d.content !== null);

  const json = {
    repo: { root: path.basename(root), commit: check.commit, branch: currentBranch(root) },
    plan: planId,
    generatedAt: new Date().toISOString(),
    checkReport: check,
    changedFiles: check.diff.files,
    memoryRecords: memory.map((m) => m.path),
  };

  const md = `# Evidence Pack: ${planId ?? "(no plan)"}

## Authority levels

- authoritative: everything in this pack (live repo, git diff, check report, verification evidence)
- advisory: any agent-authored summary NOT in this pack

## Repo Metadata

- commit: ${check.commit}
- branch: ${currentBranch(root)}
- generated: ${json.generatedAt}

## Active Plan

${planContent ? "```markdown\n" + truncate(planContent, 8000) + "\n```" : "(no active plan)"}

## Attractor Spec

\`\`\`yaml
${truncate(attractorRaw ?? "(missing)", 6000)}
\`\`\`

## Converge Check Report (deterministic)

\`\`\`json
${truncate(JSON.stringify({ status: check.status, closure: check.closure, checks: check.checks, behaviorEvidence: check.behaviorEvidence }, null, 2), 8000)}
\`\`\`

## Git Diff

\`\`\`diff
${truncate(diffText, 30000)}
\`\`\`

## Architecture Docs

${archDocs.map((d) => `### ${d.path}\n\n${truncate(d.content!, 3000)}`).join("\n\n") || "(none found)"}

## Related Memory Records

${memory.map((m) => `### ${m.path}\n\n${truncate(m.content, 1500)}`).join("\n\n") || "(none)"}
`;
  return { md, json };
}

function collectMemory(root: string): { path: string; content: string }[] {
  const memDir = path.join(root, ".converge", "memory");
  const out: { path: string; content: string }[] = [];
  if (!fs.existsSync(memDir)) return out;
  for (const type of fs.readdirSync(memDir)) {
    const typeDir = path.join(memDir, type);
    if (!fs.statSync(typeDir).isDirectory()) continue;
    for (const f of fs.readdirSync(typeDir)) {
      if (!f.endsWith(".md")) continue;
      out.push({
        path: `.converge/memory/${type}/${f}`,
        content: readFileIfExists(path.join(typeDir, f)) ?? "",
      });
    }
  }
  return out.slice(0, 20);
}

function runLlmAudit(llm: string, evidencePack: string): AuditJudgment | null {
  const prompt = `${AUDIT_PROMPT}\n\n---\n\n${evidencePack}`;
  let command: string;
  if (llm === "claude") {
    command = `claude -p --output-format text`;
  } else if (llm === "codex") {
    command = `codex exec -`;
  } else {
    return null;
  }
  try {
    const isWin = process.platform === "win32";
    const res = spawnSync(isWin ? "cmd.exe" : "sh", isWin ? ["/d", "/s", "/c", command] : ["-c", command], {
      input: prompt,
      encoding: "utf8",
      timeout: 5 * 60 * 1000, // hard cap: a hung LLM CLI must not stall closure; caller falls back to no-llm
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    if (res.status !== 0 || !res.stdout) return null;
    return parseJudgment(res.stdout);
  } catch {
    return null;
  }
}

export function parseJudgment(output: string): AuditJudgment | null {
  // extract first JSON object from the output
  const start = output.indexOf("{");
  if (start === -1) return null;
  for (let end = output.lastIndexOf("}"); end > start; end = output.lastIndexOf("}", end - 1)) {
    try {
      const obj = JSON.parse(output.slice(start, end + 1));
      if (obj && typeof obj.judgment === "string") {
        return {
          judgment: ["closed", "not_closed", "needs_human_decision"].includes(obj.judgment)
            ? obj.judgment
            : "needs_human_decision",
          blockers: toStrArr(obj.blockers),
          warnings: toStrArr(obj.warnings),
          evidence_reviewed: toStrArr(obj.evidence_reviewed),
          false_positive_risks: toStrArr(obj.false_positive_risks),
          next_actions: toStrArr(obj.next_actions),
        };
      }
    } catch {
      /* keep shrinking */
    }
  }
  return null;
}

function toStrArr(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

/** LLM audit never owns final authority: deterministic blockers always stay blockers. */
function mergeWithDeterministic(llm: AuditJudgment, check: CheckReport): AuditJudgment {
  const blockers = [...new Set([...check.closure.blockers, ...llm.blockers])];
  let judgment = llm.judgment;
  if (blockers.length > 0 && judgment === "closed") judgment = "not_closed";
  return { ...llm, judgment, blockers };
}

function deterministicJudgment(check: CheckReport): AuditJudgment {
  return {
    judgment: check.closure.allowed ? "closed" : "not_closed",
    blockers: check.closure.blockers,
    warnings: check.closure.warnings,
    evidence_reviewed: [
      "git diff",
      "converge check report",
      "verification evidence (executed by converge)",
      "attractor.yml",
    ],
    false_positive_risks: [
      "no-llm mode: semantic drift (e.g. rationalized wrong structure) is NOT audited; only deterministic checks",
    ],
    next_actions: check.closure.allowed
      ? ["run converge close <PLAN-ID>"]
      : ["resolve blockers, then re-run converge check and converge audit --fresh"],
  };
}

function renderAuditReport(planId: string | null, j: AuditJudgment, check: CheckReport): string {
  const verdict =
    j.judgment === "closed" ? "Closed" : j.judgment === "not_closed" ? "Not Closed" : "Needs Human Decision";
  return `# Fresh Audit Report: ${planId ?? "(no plan)"}

## Evidence Reviewed

${j.evidence_reviewed.map((e) => `- ${e}`).join("\n") || "- (none)"}

## Deterministic Check Status

${check.status.toUpperCase()} (blockers: ${check.closure.blockers.length}, warnings: ${check.closure.warnings.length})

## Closure Blockers

${j.blockers.map((b, i) => `${i + 1}. ${b}`).join("\n") || "(none)"}

## Warnings

${j.warnings.map((w, i) => `${i + 1}. ${w}`).join("\n") || "(none)"}

## False Positive Risks

${j.false_positive_risks.map((r) => `- ${r}`).join("\n") || "(none)"}

## Final Judgment

${verdict}.

## Required Next Action

${j.next_actions.map((a) => `- ${a}`).join("\n") || "(none)"}
`;
}
