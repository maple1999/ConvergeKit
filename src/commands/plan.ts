import path from "node:path";
import { findRepoRoot, writeFileSafe } from "../lib/paths.js";
import { nextPlanNumber, plansDir, setActivePlan, slugify } from "../lib/plans.js";
import { PLAN_TEMPLATE } from "../lib/templates.js";

export interface PlanOptions {
  type?: string;
}

const V01_TYPES = ["bugfix", "feature", "refactor", "general"];

export async function planCommand(title: string, opts: PlanOptions): Promise<void> {
  const type = opts.type ?? "general";
  if (["research", "venture"].includes(type)) {
    console.error(`--type ${type} is planned for v0.3+. v0.1 supports: ${V01_TYPES.join(", ")}.`);
    process.exitCode = 1;
    return;
  }
  if (!V01_TYPES.includes(type)) {
    console.error(`Unknown plan type "${type}". Supported: ${V01_TYPES.join(", ")}.`);
    process.exitCode = 1;
    return;
  }

  const root = findRepoRoot();
  const num = String(nextPlanNumber(root)).padStart(3, "0");
  const planId = `PLAN-${num}`;
  const file = path.join(plansDir(root), `${planId}-${slugify(title)}.md`);

  writeFileSafe(file, PLAN_TEMPLATE(num, title, type));
  setActivePlan(root, planId);

  console.log(`Created ${path.relative(root, file)}`);
  console.log(`Active plan set to ${planId} (type: ${type}).`);
  console.log(`Fill in Goal / Non-goals / Exit Criteria before letting an agent implement.`);
}
