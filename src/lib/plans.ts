import fs from "node:fs";
import path from "node:path";
import { loadState, saveState } from "./config.js";
import { readFileIfExists, writeFileSafe } from "./paths.js";

export const PLAN_STATUSES = [
  "Draft",
  "Active",
  "Implemented",
  "Checked",
  "Audited",
  "Closed",
  "Blocked",
  "Needs Human Decision",
  "Needs Rework",
] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export interface PlanInfo {
  id: string; // PLAN-001
  title: string;
  file: string; // absolute path
  status: PlanStatus;
  type: string; // bugfix | feature | refactor | general
  nonGoalPaths: string[];
  exitCriteria: { text: string; checked: boolean }[];
}

export function plansDir(root: string): string {
  return path.join(root, "docs", "plans");
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function nextPlanNumber(root: string): number {
  const dir = plansDir(root);
  if (!fs.existsSync(dir)) return 1;
  let max = 0;
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(/^PLAN-(\d+)/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

export function findPlanFile(root: string, planId: string): string | null {
  const dir = plansDir(root);
  if (!fs.existsSync(dir)) return null;
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith(planId + "-") || f === planId + ".md") {
      return path.join(dir, f);
    }
  }
  return null;
}

export function getActivePlanId(root: string): string | null {
  const state = loadState(root);
  return (state.activePlan as string) ?? null;
}

export function setActivePlan(root: string, planId: string | null): void {
  const state = loadState(root);
  if (planId === null) delete state.activePlan;
  else state.activePlan = planId;
  saveState(root, state);
}

export function parsePlan(root: string, planId: string): PlanInfo | null {
  const file = findPlanFile(root, planId);
  if (!file) return null;
  // normalize CRLF: plan files are user-edited and may carry Windows line endings
  const content = (readFileIfExists(file) ?? "").replace(/\r\n/g, "\n");

  const titleMatch = content.match(/^#\s+PLAN-\d+:\s*(.+)$/m);
  const statusMatch = content.match(/##\s*Status\s*\n+\s*([^\n]+)/);
  const typeMatch = content.match(/<!--\s*plan-type:\s*(\S+)\s*-->/);

  let status: PlanStatus = "Draft";
  if (statusMatch) {
    const s = statusMatch[1].trim();
    const found = PLAN_STATUSES.find((st) => s.toLowerCase().startsWith(st.toLowerCase()));
    if (found) status = found;
  }

  // Non-goals section: bullet lines starting with a path-ish token are treated as protected areas
  const nonGoalPaths: string[] = [];
  const ngSection = extractSection(content, "Non-goals");
  if (ngSection) {
    for (const line of ngSection.split("\n")) {
      const m = line.match(/^\s*[-*]\s*(?:path:\s*)?`?([\w./@*-]+[\w*/]+)`?\s*$/);
      if (m && (m[1].includes("/") || m[1].includes("*") || m[1].includes("."))) {
        nonGoalPaths.push(m[1]);
      }
    }
  }

  const exitCriteria: { text: string; checked: boolean }[] = [];
  const ecSection = extractSection(content, "Exit Criteria");
  if (ecSection) {
    for (const line of ecSection.split("\n")) {
      const m = line.match(/^\s*[-*]\s*\[([ xX])\]\s*(.+)$/);
      if (m) exitCriteria.push({ text: m[2].trim(), checked: m[1].toLowerCase() === "x" });
    }
  }

  return {
    id: planId,
    title: titleMatch ? titleMatch[1].trim() : planId,
    file,
    status,
    type: typeMatch ? typeMatch[1] : "general",
    nonGoalPaths,
    exitCriteria,
  };
}

export function extractSection(md: string, heading: string): string | null {
  const re = new RegExp(`^##\\s*${heading}\\s*$`, "mi");
  const m = re.exec(md);
  if (!m) return null;
  const start = m.index + m[0].length;
  const rest = md.slice(start);
  const next = rest.search(/^##\s+/m);
  return next === -1 ? rest : rest.slice(0, next);
}

export function updatePlanStatus(root: string, planId: string, status: PlanStatus): boolean {
  const file = findPlanFile(root, planId);
  if (!file) return false;
  const content = (readFileIfExists(file) ?? "").replace(/\r\n/g, "\n");
  const updated = content.replace(
    /(##\s*Status\s*\n+\s*)([^\n]+)/,
    `$1${status}`
  );
  writeFileSafe(file, updated);
  return true;
}

export function listPlans(root: string): PlanInfo[] {
  const dir = plansDir(root);
  if (!fs.existsSync(dir)) return [];
  const plans: PlanInfo[] = [];
  for (const f of fs.readdirSync(dir).sort()) {
    const m = f.match(/^(PLAN-\d+)/);
    if (m) {
      const p = parsePlan(root, m[1]);
      if (p) plans.push(p);
    }
  }
  return plans;
}
