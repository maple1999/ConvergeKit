#!/usr/bin/env node
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { planCommand } from "./commands/plan.js";
import { checkCommand } from "./commands/check.js";
import { auditCommand } from "./commands/audit.js";
import { closeCommand, closureStatusCommand } from "./commands/close.js";
import { handoffCommand } from "./commands/handoff.js";
import { memoryAddCommand } from "./commands/memory.js";
import { compileCommand } from "./commands/compile.js";
import { ConfigError } from "./lib/config.js";

const program = new Command();

program
  .name("converge")
  .description(
    "ConvergeKit — repo-native attractor-first harness for AI coding agents.\nAI agents can pass tests while drifting your architecture. ConvergeKit catches that."
  )
  .version("0.1.0");

program
  .command("init")
  .description("Initialize .converge/ structure and attractor.yml (with inferred invariant drafts)")
  .option("--mode <mode>", "project mode (v0.1: product only)", "product")
  .option("-y, --yes", "non-interactive: keep existing files")
  .option("--force", "overwrite existing attractor.yml")
  .action(wrap(initCommand));

program
  .command("plan")
  .description("Create a standardized plan with goals, non-goals and exit criteria")
  .argument("<title>", "plan title")
  .option("--type <type>", "bugfix | feature | refactor | general", "general")
  .action(wrap(planCommand));

program
  .command("check")
  .description("Check the current git diff against the attractor (boundaries, scope, test integrity, verification)")
  .option("--plan <planId>", "plan to check against (default: active plan)")
  .option("--json", "output JSON report")
  .option("--strict", "treat warnings as blockers")
  .option("--base <ref>", "diff base ref", "HEAD")
  .option("--no-exec", "skip executing verification commands and revert-rerun")
  .action(
    wrap((opts: Record<string, unknown>) =>
      checkCommand({
        plan: opts.plan as string | undefined,
        json: !!opts.json,
        strict: !!opts.strict,
        base: opts.base as string | undefined,
        noExec: opts.exec === false,
      })
    )
  );

program
  .command("audit")
  .description("Fresh audit: rebuild evidence from the live repo, independent of the implementer's summary")
  .option("--fresh", "run a fresh audit (default behavior)", true)
  .option("--plan <planId>", "plan to audit (default: active plan)")
  .option("--llm <llm>", "LLM for semantic audit: claude | codex | none", "claude")
  .option("--no-llm", "CI fallback: deterministic checks + structured audit template only")
  .option("--base <ref>", "diff base ref", "HEAD")
  .action(
    wrap((opts: Record<string, unknown>) =>
      auditCommand({
        plan: opts.plan as string | undefined,
        llm: typeof opts.llm === "string" ? opts.llm : undefined,
        noLlm: opts.llm === false,
        base: opts.base as string | undefined,
      })
    )
  );

program
  .command("close")
  .description("Close a plan if check, fresh audit and exit criteria allow it")
  .argument("<planId>", "e.g. PLAN-001")
  .option("--force", "override blockers (recorded)")
  .option("--human-approved", "human approves closure despite needs-human-decision (recorded)")
  .option("--reason <reason>", "reason for override")
  .action(wrap(closeCommand));

program
  .command("closure-status")
  .description("Show closure status of a plan (non-zero exit if not closable)")
  .argument("[planId]", "plan id (default: active plan)")
  .action(wrap(closureStatusCommand));

program
  .command("handoff")
  .description("Generate a handoff summary for the next AI session")
  .option("--plan <planId>", "focus plan")
  .option("--for <agent>", "claude | codex")
  .action(wrap(handoffCommand));

const memory = program.command("memory").description("Trajectory memory records");
memory
  .command("add")
  .description("Add a memory record (disproven-assumption | divergent-path | overturned-closure | terminology-trap)")
  .option("--type <type>", "memory type")
  .option("--summary <summary>", "one-line summary")
  .action(wrap(memoryAddCommand));

program
  .command("compile")
  .description("Compile attractor.yml into agent configs (CLAUDE.md, AGENTS.md, skills, rules)")
  .option("--target <target>", "claude | codex | opencode | cline", "claude")
  .option("--all", "compile all targets")
  .action(wrap(compileCommand));

function wrap<A extends unknown[]>(fn: (...args: A) => Promise<unknown>) {
  return async (...args: A) => {
    try {
      await fn(...args);
    } catch (e) {
      if (e instanceof ConfigError) {
        console.error(`Config error: ${e.message}`);
      } else {
        console.error(`Error: ${(e as Error).message}`);
      }
      process.exitCode = 1;
    }
  };
}

program.parseAsync();
