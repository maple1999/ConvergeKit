import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { convergeDir, readFileIfExists } from "./paths.js";

export interface Invariant {
  id: string;
  rule: string;
  severity?: "error" | "warning" | "advisory";
  check?: string;
}

export interface DependencyRule {
  id?: string;
  from: string;
  cannot_import: string;
  severity?: "error" | "warning" | "advisory";
}

export interface ForbiddenPath {
  path: string;
  severity?: "error" | "warning" | "advisory";
}

export interface AntiPattern {
  id?: string;
  description: string;
  pattern?: string;
  severity?: "error" | "warning" | "advisory";
}

export interface VerificationCommand {
  id: string;
  command: string;
  required?: boolean;
}

export interface AgentPolicy {
  require_plan_first?: boolean;
  require_read_before_edit?: boolean;
  block_close_without_audit?: boolean;
  edit_scope?: string;
  require_focused_test?: boolean;
  max_diff_lines_warning?: number;
  max_diff_lines_blocker?: number;
  require_human_approval_if_diff_over?: number;
  default_mode?: string;
  require_human_close?: boolean;
}

export interface AttractorConfig {
  version: string | number;
  mode: "product" | "research" | "venture";
  project?: { name?: string; mission?: string };
  authority?: Record<string, string[]>;
  attractor?: {
    invariants?: Invariant[];
    dependency_direction?: DependencyRule[];
    forbidden_paths?: ForbiddenPath[];
    anti_patterns?: AntiPattern[];
  };
  verification?: {
    executed_by?: string;
    evidence_dir?: string;
    record?: string[];
    before_close?: VerificationCommand[];
  };
  closure?: {
    require_fresh_audit?: boolean;
    require_plan_exit_criteria?: boolean;
    require_validation_logs?: boolean;
    allow_human_override?: boolean;
  };
  agent_policy?: Record<string, AgentPolicy>;
  test_files?: string[]; // globs identifying test files
}

export class ConfigError extends Error {}

export function attractorPath(root: string): string {
  return path.join(convergeDir(root), "attractor.yml");
}

export function loadAttractor(root: string): AttractorConfig {
  const file = attractorPath(root);
  const raw = readFileIfExists(file);
  if (raw === null) {
    throw new ConfigError(
      `No .converge/attractor.yml found at ${file}. Run "converge init" first.`
    );
  }
  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (e) {
    throw new ConfigError(`Failed to parse attractor.yml: ${(e as Error).message}`);
  }
  return validateAttractor(parsed);
}

const VALID_SEVERITIES = ["error", "warning", "advisory"];

export function validateAttractor(data: unknown): AttractorConfig {
  if (typeof data !== "object" || data === null) {
    throw new ConfigError("attractor.yml must be a YAML mapping at top level.");
  }
  const cfg = data as AttractorConfig;
  if (cfg.version === undefined) {
    throw new ConfigError('attractor.yml: missing required field "version".');
  }
  if (!cfg.mode) {
    throw new ConfigError('attractor.yml: missing required field "mode".');
  }
  if (!["product", "research", "venture"].includes(cfg.mode)) {
    throw new ConfigError(
      `attractor.yml: invalid mode "${cfg.mode}". Expected product | research | venture.`
    );
  }
  if (cfg.mode !== "product") {
    throw new ConfigError(
      `attractor.yml: mode "${cfg.mode}" is planned for v0.3+. v0.1 supports mode: product only.`
    );
  }
  const att = cfg.attractor ?? {};
  for (const inv of att.invariants ?? []) {
    if (!inv.id || !inv.rule) {
      throw new ConfigError("attractor.yml: each invariant needs id and rule.");
    }
    if (inv.severity && !VALID_SEVERITIES.includes(inv.severity)) {
      throw new ConfigError(
        `attractor.yml: invariant ${inv.id} has invalid severity "${inv.severity}".`
      );
    }
  }
  for (const dep of att.dependency_direction ?? []) {
    if (!dep.from || !dep.cannot_import) {
      throw new ConfigError(
        "attractor.yml: each dependency_direction rule needs from and cannot_import."
      );
    }
  }
  for (const fp of att.forbidden_paths ?? []) {
    if (!fp.path) {
      throw new ConfigError("attractor.yml: each forbidden_paths entry needs path.");
    }
  }
  for (const cmd of cfg.verification?.before_close ?? []) {
    if (!cmd.id || !cmd.command) {
      throw new ConfigError("attractor.yml: each verification command needs id and command.");
    }
  }
  return cfg;
}

export function testFileGlobs(cfg: AttractorConfig): string[] {
  return (
    cfg.test_files ?? [
      "**/*.test.*",
      "**/*.spec.*",
      "**/tests/**",
      "**/test/**",
      "**/__tests__/**",
    ]
  );
}

export function saveState(root: string, state: Record<string, unknown>): void {
  const file = path.join(convergeDir(root), "state.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2), "utf8");
}

export function loadState(root: string): Record<string, unknown> {
  const raw = readFileIfExists(path.join(convergeDir(root), "state.json"));
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
