import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { findRepoRoot, readFileIfExists, writeFileSafe } from "../lib/paths.js";
import { listPlans } from "../lib/plans.js";

export interface HandoffOptions {
  plan?: string;
  for?: string; // claude | codex
}

export function generateHandoff(root: string, opts: HandoffOptions): string {
  const attractorRaw = readFileIfExists(path.join(root, ".converge", "attractor.yml"));
  let mission = "";
  let invariants: string[] = [];
  try {
    const cfg = YAML.parse(attractorRaw ?? "");
    mission = cfg?.project?.mission ?? "";
    invariants = (cfg?.attractor?.invariants ?? []).map(
      (i: { id: string; rule: string }) => `- ${i.id}: ${i.rule}`
    );
    for (const d of cfg?.attractor?.dependency_direction ?? []) {
      invariants.push(`- ${d.id ?? "dep"}: ${d.from} must not import ${d.cannot_import}`);
    }
  } catch {
    /* attractor unreadable */
  }

  const plans = listPlans(root);
  const active = plans.filter((p) => !["Closed"].includes(p.status));
  const closed = plans.filter((p) => p.status === "Closed").slice(-5);

  // recent audit findings
  const auditsDir = path.join(root, "docs", "audits");
  const auditSummaries: string[] = [];
  if (fs.existsSync(auditsDir)) {
    for (const f of fs.readdirSync(auditsDir).sort().slice(-3)) {
      const content = readFileIfExists(path.join(auditsDir, f)) ?? "";
      const judgment = content.match(/## Final Judgment\s*\n+([^\n]+)/)?.[1] ?? "?";
      auditSummaries.push(`- ${f}: ${judgment.trim()}`);
    }
  }

  // memory
  const memSections: Record<string, string[]> = {
    "disproven-assumptions": [],
    "divergent-paths": [],
    "overturned-closures": [],
    "terminology-traps": [],
  };
  const memDir = path.join(root, ".converge", "memory");
  for (const type of Object.keys(memSections)) {
    const dir = path.join(memDir, type);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
      const content = readFileIfExists(path.join(dir, f)) ?? "";
      const summary = content.match(/## Summary\s*\n+([^\n#]+)/)?.[1]?.trim() ?? f;
      memSections[type].push(`- ${summary} (.converge/memory/${type}/${f})`);
    }
  }

  const forAgent = opts.for ?? null;
  const agentInstructions =
    forAgent === "codex"
      ? `Read AGENTS.md. Before claiming completion run: converge check, converge audit --fresh, converge close <PLAN_ID>. Do not weaken tests. Do not touch non-goal areas.`
      : `Read CLAUDE.md. Before claiming completion run: converge check, converge audit --fresh, converge close <PLAN_ID>. Do not weaken tests. Do not touch non-goal areas.`;

  const md = `# ConvergeKit Handoff

Generated: ${new Date().toISOString()}${forAgent ? ` (for: ${forAgent})` : ""}

## Current Attractor Summary

${mission ? `Mission: ${mission}\n\n` : ""}${invariants.join("\n") || "(no invariants defined)"}

## Active Plans

${active.map((p) => `- ${p.id}: ${p.title} [${p.status}]`).join("\n") || "(none)"}

## Last Closed Plans

${closed.map((p) => `- ${p.id}: ${p.title}`).join("\n") || "(none)"}

## Open Risks

${active.filter((p) => ["Blocked", "Needs Rework", "Needs Human Decision"].includes(p.status)).map((p) => `- ${p.id} is ${p.status}`).join("\n") || "(none recorded)"}

## Recent Audit Findings

${auditSummaries.join("\n") || "(none)"}

## Disproven Assumptions

${memSections["disproven-assumptions"].join("\n") || "(none)"}

## Divergent Paths

${memSections["divergent-paths"].join("\n") || "(none)"}

## Overturned Closures

${memSections["overturned-closures"].join("\n") || "(none)"}

## Terminology Traps

${memSections["terminology-traps"].join("\n") || "(none)"}

## Recommended Next Step

${active.length > 0 ? `Continue ${active[0].id} (${active[0].status}).` : "No active plan. Create one with: converge plan \"<title>\""}

## Agent Instructions

${agentInstructions}
`;

  writeFileSafe(path.join(root, ".converge", "handoff.md"), md);
  return md;
}

export async function handoffCommand(opts: HandoffOptions): Promise<void> {
  const root = findRepoRoot();
  const md = generateHandoff(root, opts);
  console.log(md);
  console.log(`\n(written to .converge/handoff.md)`);
}
