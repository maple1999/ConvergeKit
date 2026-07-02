import fs from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import type { AttractorConfig, DependencyRule } from "../lib/config.js";
import type { DiffSummary } from "../lib/git.js";
import type { Finding } from "../lib/report.js";
import { toRepoRel } from "../lib/paths.js";

/**
 * B. Dependency Direction Check (BoundaryCheckAdapter).
 *
 * Adapter design per PRD §13.3: wrap an existing boundary tool instead of
 * self-building full import-graph analysis. Engines, in order:
 *   1. dependency-cruiser (primary, JS/TS) — full resolver incl. tsconfig
 *      paths, cruised over the rule directories, verdict filtered to changed
 *      files only.
 *   2. builtin diff-scoped scanner (fallback) — parses import/require
 *      specifiers of the *changed* files and resolves relative imports.
 *      Used when dependency-cruiser is unavailable or fails on the repo.
 */
export async function checkDependencyDirection(
  root: string,
  cfg: AttractorConfig,
  diff: DiffSummary
): Promise<Finding[]> {
  const rules = cfg.attractor?.dependency_direction ?? [];
  if (rules.length === 0) return [];

  const changed = diff.files.filter((f) => f.status !== "D").map((f) => f.path);

  let engine = "dependency-cruiser";
  let violationsByRule: Map<DependencyRule, Violation[]> | null = null;
  try {
    violationsByRule = await scanWithDependencyCruiser(root, rules, new Set(changed));
  } catch {
    violationsByRule = null;
  }
  if (violationsByRule === null) {
    engine = "builtin diff-scoped scanner";
    violationsByRule = await scanWithBuiltin(root, rules, changed);
  }

  return rules.map((rule): Finding => {
    const id = rule.id ?? `dep:${rule.from}->!${rule.cannot_import}`;
    const violations = violationsByRule!.get(rule) ?? [];
    return {
      id,
      severity: rule.severity ?? "error",
      result: violations.length > 0 ? "failed" : "passed",
      evidence:
        violations.length > 0
          ? violations.map((v) => `${v.from} imports ${v.to}`).join("\n") +
            `\n(engine: ${engine})`
          : `no boundary violations in changed files (engine: ${engine})`,
    };
  });
}

interface Violation {
  from: string;
  to: string;
}

interface RuleMatcher {
  rule: DependencyRule;
  fromMatch: (s: string) => boolean;
  targetMatch: (s: string) => boolean;
}

function buildMatchers(rules: DependencyRule[]): RuleMatcher[] {
  return rules.map((r) => ({
    rule: r,
    fromMatch: picomatch(r.from, { dot: true }),
    targetMatch: picomatch(r.cannot_import, { dot: true }),
  }));
}

// ---------- engine 1: dependency-cruiser ----------

async function scanWithDependencyCruiser(
  root: string,
  rules: DependencyRule[],
  changed: Set<string>
): Promise<Map<DependencyRule, Violation[]>> {
  const { cruise } = await import("dependency-cruiser");

  // cruise the top-level directories referenced by the rules
  const dirs = [
    ...new Set(
      rules
        .flatMap((r) => [r.from, r.cannot_import])
        .map((g) => g.split("/")[0])
        .filter((seg) => seg && !seg.includes("*"))
    ),
  ].filter((d) => fs.existsSync(path.join(root, d)));
  if (dirs.length === 0) throw new Error("no rule directories exist on disk");

  const prevCwd = process.cwd();
  process.chdir(root);
  try {
    const r = await cruise(dirs, {
      doNotFollow: { path: "node_modules" },
      tsPreCompilationDeps: true,
      combinedDependencies: false,
    });
    const out = typeof r.output === "string" ? JSON.parse(r.output) : r.output;
    const modules = (out.modules ?? []) as {
      source: string;
      dependencies: { resolved: string }[];
    }[];

    const matchers = buildMatchers(rules);
    const result = new Map<DependencyRule, Violation[]>();
    for (const mod of modules) {
      const src = mod.source.replace(/\\/g, "/");
      if (!changed.has(src)) continue;
      const applicable = matchers.filter((m) => m.fromMatch(src));
      if (applicable.length === 0) continue;
      for (const dep of mod.dependencies ?? []) {
        const resolved = (dep.resolved ?? "").replace(/\\/g, "/");
        for (const m of applicable) {
          if (m.targetMatch(resolved)) {
            const list = result.get(m.rule) ?? [];
            list.push({ from: src, to: resolved });
            result.set(m.rule, list);
          }
        }
      }
    }
    return result;
  } finally {
    process.chdir(prevCwd);
  }
}

// ---------- engine 2: builtin diff-scoped scanner ----------

const IMPORT_RE =
  /(?:import\s+(?:[\s\S]*?)\s+from\s+|import\s*\(\s*|require\s*\(\s*|export\s+(?:[\s\S]*?)\s+from\s+|import\s+)["']([^"']+)["']/g;

const RESOLVE_EXTS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

async function scanWithBuiltin(
  root: string,
  rules: DependencyRule[],
  changedFiles: string[]
): Promise<Map<DependencyRule, Violation[]>> {
  const result = new Map<DependencyRule, Violation[]>();
  const matchers = buildMatchers(rules);

  for (const file of changedFiles) {
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file)) continue;
    const applicable = matchers.filter((m) => m.fromMatch(file));
    if (applicable.length === 0) continue;

    const abs = path.join(root, file);
    let content: string;
    try {
      content = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }

    for (const spec of extractImportSpecifiers(content)) {
      const resolved = resolveImport(root, file, spec);
      if (!resolved) continue;
      for (const m of applicable) {
        if (m.targetMatch(resolved)) {
          const list = result.get(m.rule) ?? [];
          list.push({ from: file, to: resolved });
          result.set(m.rule, list);
        }
      }
    }
  }
  return result;
}

export function extractImportSpecifiers(source: string): string[] {
  const specs: string[] = [];
  let m: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(source)) !== null) {
    specs.push(m[1]);
  }
  return specs;
}

/** Resolve a relative import specifier to a repo-relative path; bare imports return null. */
export function resolveImport(root: string, fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".") && !spec.startsWith("/")) return null;
  const baseDir = path.dirname(path.join(root, fromFile));
  const target = spec.startsWith("/") ? path.join(root, spec) : path.resolve(baseDir, spec);
  for (const ext of RESOLVE_EXTS) {
    const candidate = target + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return toRepoRel(root, candidate);
    }
  }
  // directory index
  for (const ext of RESOLVE_EXTS.slice(1)) {
    const candidate = path.join(target, "index" + ext);
    if (fs.existsSync(candidate)) return toRepoRel(root, candidate);
  }
  // even if the file doesn't resolve on disk (e.g. .js specifier for .ts source),
  // fall back to the literal path so glob rules still apply
  const literal = toRepoRel(root, target);
  return literal.startsWith("..") ? null : literal;
}
