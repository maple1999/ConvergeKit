import path from "node:path";
import { loadAttractor, type AttractorConfig } from "../lib/config.js";
import { findRepoRoot, readFileIfExists, writeFileSafe } from "../lib/paths.js";

export interface CompileOptions {
  target?: string;
  all?: boolean;
}

const GEN_START = "<!-- convergekit:generated:start -->";
const GEN_END = "<!-- convergekit:generated:end -->";

/**
 * Compile attractor.yml into agent-readable configs.
 * attractor.yml is the source; CLAUDE.md / AGENTS.md are build artifacts.
 * Manual content outside the generated markers is preserved.
 */
export async function compileCommand(opts: CompileOptions): Promise<void> {
  const root = findRepoRoot();
  const cfg = loadAttractor(root);

  const targets = opts.all
    ? ["claude", "codex", "opencode", "cline"]
    : [opts.target ?? "claude"];

  for (const target of targets) {
    switch (target) {
      case "claude":
        compileClaude(root, cfg);
        break;
      case "codex":
        compileCodex(root, cfg);
        break;
      case "opencode":
        writeGenerated(root, ".opencode/instructions.md", rulesBody(cfg, "OpenCode"));
        console.log("Generated .opencode/instructions.md");
        break;
      case "cline":
        writeGenerated(root, ".clinerules", rulesBody(cfg, "Cline"));
        console.log("Generated .clinerules");
        break;
      default:
        console.error(`Unknown target "${target}". Supported: claude, codex, opencode, cline.`);
        process.exitCode = 1;
    }
  }
}

function attractorSummary(cfg: AttractorConfig): string {
  const lines: string[] = [];
  for (const inv of cfg.attractor?.invariants ?? []) {
    lines.push(`- **${inv.id}** (${inv.severity ?? "error"}): ${inv.rule}`);
  }
  for (const d of cfg.attractor?.dependency_direction ?? []) {
    lines.push(
      `- **${d.id ?? "dependency"}** (${d.severity ?? "error"}): \`${d.from}\` must NOT import \`${d.cannot_import}\``
    );
  }
  for (const f of cfg.attractor?.forbidden_paths ?? []) {
    lines.push(`- **forbidden path** (${f.severity ?? "error"}): do not modify \`${f.path}\``);
  }
  return lines.join("\n") || "(no invariants defined yet)";
}

function antiPatterns(cfg: AttractorConfig): string {
  return (
    (cfg.attractor?.anti_patterns ?? [])
      .map((a) => `- ${a.description}`)
      .join("\n") || "(none)"
  );
}

function verificationCommands(cfg: AttractorConfig): string {
  return (
    (cfg.verification?.before_close ?? [])
      .map((c) => `- \`${c.command}\`${c.required ? " (required)" : ""}`)
      .join("\n") || "(none configured)"
  );
}

function authorityOrder(cfg: AttractorConfig): string {
  const entries = Object.entries(cfg.authority ?? {});
  if (entries.length === 0) return "(not configured)";
  return entries
    .map(([k, paths]) => `- ${k}: ${(paths ?? []).map((p) => `\`${p}\``).join(", ")}`)
    .join("\n");
}

function rulesBody(cfg: AttractorConfig, agentName: string): string {
  return `# ConvergeKit Rules (${agentName})

Generated from .converge/attractor.yml — edit that file, not this one.

## Project Mission

${cfg.project?.mission ?? "(none)"}

## Attractor Invariants

${attractorSummary(cfg)}

## Anti-patterns

${antiPatterns(cfg)}

## Plan / Closure Protocol

1. Before non-trivial work, ensure an active plan exists: \`converge plan "<title>"\`.
2. Implement within plan scope. Do not touch non-goal areas.
3. NEVER weaken tests to make them pass. Test changes are audited by test-revert-rerun.
4. Before claiming completion, run:
   - \`converge check\`
   - \`converge audit --fresh\`
   - \`converge close <PLAN_ID>\`
5. Your own completion summary is advisory evidence only. Closure decisions
   rely on verification commands executed by converge itself.

## Required Commands

${verificationCommands(cfg)}
`;
}

function compileClaude(root: string, cfg: AttractorConfig): void {
  const body = `# Project ConvergeKit Rules

This section is generated from .converge/attractor.yml.
Do not edit generated sections manually. Edit .converge/attractor.yml and run \`converge compile --target claude\`.

## Project Mission

${cfg.project?.mission ?? "(none)"}

## Authority Order

${authorityOrder(cfg)}

## Attractor Invariants

${attractorSummary(cfg)}

## Anti-patterns

${antiPatterns(cfg)}

## Plan / Closure Protocol

- Create a plan before non-trivial work: \`converge plan "<title>"\`
- After implementing: \`converge check\` → \`converge audit --fresh\` → \`converge close <PLAN_ID>\`
- Closure evidence comes ONLY from commands executed by converge; your summary is advisory.
- Never weaken tests: test file changes trigger test-revert-rerun.

## Required Commands

${verificationCommands(cfg)}

## When To Use ConvergeKit Skills

- converge-plan: at the start of any non-trivial task
- converge-check: after making changes, before declaring done
- converge-audit: when a task implementation appears complete
- converge-close: to formally close a plan
`;
  writeGenerated(root, "CLAUDE.md", body);
  console.log("Generated CLAUDE.md");

  const skills: Record<string, { desc: string; body: string }> = {
    "converge-plan": {
      desc: "Use at the start of a non-trivial task to create a ConvergeKit plan with goals, non-goals and exit criteria.",
      body: `Run:\n\n\`\`\`bash\nconverge plan "<task title>" --type <bugfix|feature|refactor>\n\`\`\`\n\nThen fill in Goal, Non-goals (protected paths), and Exit Criteria in the generated plan file before implementing.`,
    },
    "converge-check": {
      desc: "Use after making code changes to verify the diff against the repo attractor (boundaries, forbidden paths, test integrity, scope).",
      body: `Run:\n\n\`\`\`bash\nconverge check\n\`\`\`\n\nFix every blocker before proceeding. Warnings should be addressed or explicitly justified in the plan.`,
    },
    "converge-audit": {
      desc: "Use when a task implementation appears complete and needs independent closure audit.",
      body: `Run:\n\n\`\`\`bash\nconverge audit --fresh\n\`\`\`\n\nDo not treat the implementer's final summary as authoritative evidence.\nUse live repo, git diff, plan, attractor, and verification evidence executed by converge.`,
    },
    "converge-close": {
      desc: "Use to formally close a plan after check and fresh audit pass.",
      body: `Run:\n\n\`\`\`bash\nconverge close <PLAN_ID>\n\`\`\`\n\nIf closure is blocked, resolve blockers and re-run check + audit. Never use --force without recording a reason.`,
    },
  };
  for (const [name, s] of Object.entries(skills)) {
    const skillMd = `---
name: ${name}
description: ${s.desc}
---

# ${name}

Generated by ConvergeKit from .converge/attractor.yml.

${s.body}
`;
    writeFileSafe(path.join(root, ".claude", "skills", name, "SKILL.md"), skillMd);
  }
  console.log("Generated .claude/skills/{converge-plan,converge-check,converge-audit,converge-close}/SKILL.md");
}

function compileCodex(root: string, cfg: AttractorConfig): void {
  const body = `# ConvergeKit Project Guidance

Generated from .converge/attractor.yml — edit that file, then run \`converge compile --target codex\`.

## Authority

${authorityOrder(cfg)}

## Current Attractor

${attractorSummary(cfg)}

## Plan Protocol

Create a plan before non-trivial work: \`converge plan "<title>"\`.
Respect plan non-goals. Keep bugfix diffs minimal.

## Closure Protocol

A task is NOT complete when tests pass. It is complete when \`converge close <PLAN_ID>\` succeeds.
Closure evidence comes only from commands executed by converge itself.

## Validation Commands

${verificationCommands(cfg)}

## Prohibited Shortcuts

${antiPatterns(cfg)}
- Never weaken tests to make them pass (detected by test-revert-rerun).
- Never edit forbidden paths.

## Use ConvergeKit

Before claiming completion, run or request:
- converge check
- converge audit --fresh
- converge close <PLAN_ID>
`;
  writeGenerated(root, "AGENTS.md", body);
  console.log("Generated AGENTS.md");

  for (const name of ["converge-plan", "converge-check", "converge-audit", "converge-close"]) {
    const skillMd = `---
name: ${name}
description: ConvergeKit ${name.replace("converge-", "")} step — see AGENTS.md closure protocol.
---

# ${name}

Generated by ConvergeKit. Run \`${name.replace("-", " ")}\` and follow the closure protocol in AGENTS.md.
`;
    writeFileSafe(path.join(root, ".codex", "skills", name, "SKILL.md"), skillMd);
  }
  console.log("Generated .codex/skills/*/SKILL.md");
}

/** Write content inside generated markers, preserving any manual content outside them. */
export function writeGenerated(root: string, relPath: string, body: string): void {
  const file = path.join(root, relPath);
  const generated = `${GEN_START}\n${body.trim()}\n${GEN_END}`;
  const existing = readFileIfExists(file);
  if (existing && existing.includes(GEN_START) && existing.includes(GEN_END)) {
    const before = existing.slice(0, existing.indexOf(GEN_START));
    const after = existing.slice(existing.indexOf(GEN_END) + GEN_END.length);
    writeFileSafe(file, `${before}${generated}${after}`);
  } else if (existing && existing.trim().length > 0) {
    // preserve pre-existing manual file content above the generated block
    writeFileSafe(file, `${existing.trimEnd()}\n\n${generated}\n`);
  } else {
    writeFileSafe(file, `${generated}\n`);
  }
}
