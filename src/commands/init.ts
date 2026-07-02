import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { convergeDir, writeFileSafe } from "../lib/paths.js";
import { STARTER_ATTRACTOR, ARCHITECTURE_README } from "../lib/templates.js";

export interface InitOptions {
  mode?: string;
  yes?: boolean; // non-interactive: accept defaults, skip existing files
  force?: boolean; // overwrite existing files
}

const DIRS = [
  ".converge/profiles",
  ".converge/templates",
  ".converge/memory/disproven-assumptions",
  ".converge/memory/divergent-paths",
  ".converge/memory/overturned-closures",
  ".converge/memory/terminology-traps",
  ".converge/traces",
  ".converge/reports",
  ".converge/adapters/claude",
  ".converge/adapters/codex",
  ".converge/adapters/opencode",
  ".converge/adapters/cline",
  "docs/architecture",
  "docs/plans",
  "docs/audits",
  "docs/logs",
  "docs/decisions",
];

/** Known layer names → the layers they must not import. Used for cold-start inference. */
const LAYER_RULES: Record<string, string[]> = {
  ui: ["db", "database", "dal", "repository", "repositories"],
  components: ["db", "database", "dal"],
  views: ["db", "database", "dal"],
  pages: ["db", "database", "dal"],
  service: ["ui", "components", "views", "pages"],
  services: ["ui", "components", "views", "pages"],
  domain: ["ui", "components", "views", "pages", "api", "routes"],
  core: ["ui", "components", "views", "pages"],
};

export function inferDependencyRules(
  root: string
): { id: string; from: string; cannot_import: string }[] {
  const srcCandidates = ["src", "lib", "app"];
  const rules: { id: string; from: string; cannot_import: string }[] = [];
  for (const src of srcCandidates) {
    const srcDir = path.join(root, src);
    if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) continue;
    const subdirs = fs
      .readdirSync(srcDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const dir of subdirs) {
      const targets = LAYER_RULES[dir.toLowerCase()];
      if (!targets) continue;
      for (const t of targets) {
        if (subdirs.some((s) => s.toLowerCase() === t)) {
          const target = subdirs.find((s) => s.toLowerCase() === t)!;
          rules.push({
            id: `${dir}-cannot-import-${target}`,
            from: `${src}/${dir}/**`,
            cannot_import: `${src}/${target}/**`,
          });
        }
      }
    }
  }
  return rules;
}

async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (a) => {
      rl.close();
      resolve(a.trim().toLowerCase());
    })
  );
}

export async function initCommand(opts: InitOptions): Promise<void> {
  const mode = opts.mode ?? "product";
  if (mode !== "product") {
    console.error(
      `mode "${mode}" is planned for v0.3+. v0.1 supports --mode product only.`
    );
    process.exitCode = 1;
    return;
  }

  const root = process.cwd();
  const attractorFile = path.join(convergeDir(root), "attractor.yml");

  if (fs.existsSync(attractorFile) && !opts.force) {
    if (opts.yes) {
      console.log(".converge/attractor.yml already exists — skipping (use --force to overwrite).");
    } else {
      const answer = await ask(
        ".converge/attractor.yml already exists. [m]erge dirs only / [o]verwrite / [s]kip? "
      );
      if (answer === "o") {
        opts.force = true;
      } else if (answer !== "m") {
        console.log("Skipped.");
        return;
      }
    }
  }

  for (const d of DIRS) fs.mkdirSync(path.join(root, d), { recursive: true });

  const inferred = inferDependencyRules(root);
  const hasNpm = fs.existsSync(path.join(root, "package.json"));
  const projectName = path.basename(root);

  if (!fs.existsSync(attractorFile) || opts.force) {
    writeFileSafe(
      attractorFile,
      STARTER_ATTRACTOR({ projectName, inferredDeps: inferred, hasNpm })
    );
    console.log(`Created .converge/attractor.yml (mode: product)`);
    if (inferred.length > 0) {
      console.log(`\nInferred ${inferred.length} dependency rule(s) from directory structure:`);
      for (const r of inferred) {
        console.log(`  - ${r.id}: ${r.from} must not import ${r.cannot_import}`);
      }
      console.log(`Review them in .converge/attractor.yml and adjust before relying on them.`);
    }
  }

  const archReadme = path.join(root, "docs", "architecture", "README.md");
  if (!fs.existsSync(archReadme)) writeFileSafe(archReadme, ARCHITECTURE_README);

  console.log(`\nConvergeKit initialized. Structure:`);
  console.log(`  .converge/   attractor, profiles, templates, memory, traces, reports`);
  console.log(`  docs/        architecture, plans, audits, logs, decisions`);
  console.log(`\nNext steps:`);
  console.log(`  1. Review .converge/attractor.yml`);
  console.log(`  2. converge plan "<task title>"`);
  console.log(`  3. let your AI agent work`);
  console.log(`  4. converge check && converge audit --fresh && converge close <PLAN-ID>`);
}
