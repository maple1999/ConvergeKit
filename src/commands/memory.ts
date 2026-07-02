import path from "node:path";
import { findRepoRoot, writeFileSafe } from "../lib/paths.js";
import { MEMORY_TEMPLATE } from "../lib/templates.js";
import { slugify } from "../lib/plans.js";

const MEMORY_TYPES = [
  "disproven-assumption",
  "divergent-path",
  "overturned-closure",
  "terminology-trap",
] as const;

const TYPE_DIRS: Record<string, string> = {
  "disproven-assumption": "disproven-assumptions",
  "divergent-path": "divergent-paths",
  "overturned-closure": "overturned-closures",
  "terminology-trap": "terminology-traps",
};

export interface MemoryAddOptions {
  type?: string;
  summary?: string;
}

export async function memoryAddCommand(opts: MemoryAddOptions): Promise<void> {
  const type = opts.type;
  if (!type || !MEMORY_TYPES.includes(type as (typeof MEMORY_TYPES)[number])) {
    console.error(`--type is required. One of: ${MEMORY_TYPES.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  const root = findRepoRoot();
  const dir = path.join(root, ".converge", "memory", TYPE_DIRS[type]);
  const stamp = new Date().toISOString().slice(0, 10);
  const name = opts.summary ? slugify(opts.summary) : "record";
  const file = path.join(dir, `${stamp}-${name}.md`);

  let content = MEMORY_TEMPLATE(
    type
      .split("-")
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(" ")
  );
  if (opts.summary) {
    content = content.replace("## Summary\n", `## Summary\n\n${opts.summary}\n`);
  }
  writeFileSafe(file, content);
  console.log(`Created ${path.relative(root, file)}`);
  console.log("Fill in: Context / What Was Assumed / What Disproved It / Evidence / Future Instruction.");
  console.log("It will be included in future handoffs and fresh-audit evidence packs.");
}
