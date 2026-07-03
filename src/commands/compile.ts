import path from "node:path";
import { loadAttractor, type AttractorConfig } from "../lib/config.js";
import { findRepoRoot, readFileIfExists, writeFileSafe } from "../lib/paths.js";

export interface CompileOptions {
  target?: string;
  all?: boolean;
  /** opt-in: generate Claude Code Stop hook + settings entry */
  withHooks?: boolean;
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
        compileClaude(root, cfg, { withHooks: !!opts.withHooks });
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
5. If check/audit blocks closure, run \`converge correction\` and follow the Correction
   Packet before continuing. The packet is authoritative feedback — do not replace it
   with your own completion summary.
6. Your own completion summary is advisory evidence only. Closure decisions
   rely on verification commands executed by converge itself.

## Required Commands

${verificationCommands(cfg)}
`;
}

function compileClaude(
  root: string,
  cfg: AttractorConfig,
  opts: { withHooks?: boolean } = {}
): void {
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
- If converge check/audit blocks closure, run \`converge correction\` and follow the Correction Packet before continuing.
- Closure evidence comes ONLY from commands executed by converge; your summary is advisory.
- Never weaken tests: test file changes trigger test-revert-rerun.

## Required Commands

${verificationCommands(cfg)}

## When To Use ConvergeKit Skills

- converge-plan: at the start of any non-trivial task
- converge-check: after making changes, before declaring done
- converge-audit: when a task implementation appears complete
- converge-correction: when check/audit blocks closure — get the repair packet
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
      body: `Run:\n\n\`\`\`bash\nconverge check\n\`\`\`\n\nFix every blocker before proceeding. If closure is blocked, run \`converge correction\` and follow the Correction Packet. Warnings should be addressed or explicitly justified in the plan.`,
    },
    "converge-audit": {
      desc: "Use when a task implementation appears complete and needs independent closure audit.",
      body: `Run:\n\n\`\`\`bash\nconverge audit --fresh\n\`\`\`\n\nDo not treat the implementer's final summary as authoritative evidence.\nUse live repo, git diff, plan, attractor, and verification evidence executed by converge.\nIf the judgment is not CLOSED, run \`converge correction\` for the repair packet.`,
    },
    "converge-correction": {
      desc: "Use when converge check or audit blocks closure — generates the authoritative Correction Packet describing what to repair and how.",
      body: `Run:\n\n\`\`\`bash\nconverge correction --for claude\n\`\`\`\n\nThe Correction Packet is authoritative feedback. Follow its "Allowed repair direction" and "Do Not" sections exactly.\nDo not replace it with your own completion summary; do not weaken tests or the attractor to satisfy it.`,
    },
    "converge-close": {
      desc: "Use to formally close a plan after check and fresh audit pass.",
      body: `Run:\n\n\`\`\`bash\nconverge close <PLAN_ID>\n\`\`\`\n\nIf closure is blocked, run \`converge correction\`, resolve blockers and re-run check + audit. Never use --force without recording a reason.`,
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
  console.log(
    "Generated .claude/skills/{converge-plan,converge-check,converge-audit,converge-correction,converge-close}/SKILL.md"
  );

  if (opts.withHooks) compileClaudeHooks(root);
}

const STOP_HOOK_SCRIPT = `#!/usr/bin/env bash
# ConvergeKit Stop hook (generated by: converge compile --target claude --with-hooks)
# When the session tries to stop while closure is blocked, feed the correction
# instruction back to the agent. Opt-in; remove the hook entry in
# .claude/settings.json to disable.

input="$(cat 2>/dev/null || true)"
# avoid infinite stop loops: if we already blocked once, let the session stop
if printf '%s' "$input" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

out="$(converge check --no-exec --json 2>/dev/null || true)"
if printf '%s' "$out" | grep -q '"status": *"blocked"'; then
  echo "ConvergeKit: closure is BLOCKED. Run 'converge correction --for claude' and follow the Correction Packet before declaring completion. Do not weaken tests or the attractor to pass." >&2
  exit 2
fi
exit 0
`;

/** Opt-in Stop hook: script + merged .claude/settings.json entry. */
function compileClaudeHooks(root: string): void {
  const hookRel = ".claude/hooks/converge-stop-check.sh";
  writeFileSafe(path.join(root, hookRel), STOP_HOOK_SCRIPT);
  console.log(`Generated ${hookRel}`);

  const settingsFile = path.join(root, ".claude", "settings.json");
  const hookEntry = {
    hooks: [{ type: "command", command: `bash ${hookRel}` }],
  };
  const raw = readFileIfExists(settingsFile);
  let settings: Record<string, any>;
  try {
    settings = raw ? JSON.parse(raw) : {};
  } catch {
    console.error(
      `.claude/settings.json exists but is not valid JSON — add this Stop hook manually:\n` +
        JSON.stringify({ hooks: { Stop: [hookEntry] } }, null, 2)
    );
    return;
  }
  settings.hooks ??= {};
  settings.hooks.Stop ??= [];
  const already = JSON.stringify(settings.hooks.Stop).includes("converge-stop-check");
  if (!already) {
    settings.hooks.Stop.push(hookEntry);
    writeFileSafe(settingsFile, JSON.stringify(settings, null, 2) + "\n");
    console.log("Updated .claude/settings.json (hooks.Stop → converge-stop-check)");
  } else {
    console.log(".claude/settings.json already contains the converge-stop-check hook");
  }
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
Do not mark a task complete unless \`converge close <PLAN_ID>\` succeeds.
If blocked, run \`converge correction --for codex\` and revise the patch.
A ConvergeKit Correction Packet is authoritative feedback. Do not replace it with your own completion summary.

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

If closure is blocked: converge correction --for codex
`;
  writeGenerated(root, "AGENTS.md", body);
  console.log("Generated AGENTS.md");

  for (const name of [
    "converge-plan",
    "converge-check",
    "converge-audit",
    "converge-correction",
    "converge-close",
  ]) {
    const skillMd = `---
name: ${name}
description: ConvergeKit ${name.replace("converge-", "")} step — see AGENTS.md closure protocol.
---

# ${name}

Generated by ConvergeKit. Run \`${name.replace("-", " ")}\` and follow the closure protocol in AGENTS.md.
${
  name === "converge-correction"
    ? "\nUse when converge check/audit blocks closure. The Correction Packet is authoritative feedback: follow its allowed repair direction; never weaken tests or the attractor to satisfy it.\n"
    : ""
}`;
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
