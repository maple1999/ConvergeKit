import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyRestoredFiles } from "../src/checks/testIntegrity.js";

const CLI = path.resolve(__dirname, "..", "dist", "cli.js");

/**
 * v0.1-beta trust & safety suite:
 *  - CI trust boundary: --config-from-base defeats PRs that weaken the attractor
 *  - attractor-config-modified → needs human decision
 *  - --base auto / --config-from-base auto (GitHub Actions inference)
 *  - test-revert-rerun working-tree safety (restore verification, side effects)
 *  - isolated test-integrity mode (temp git worktree)
 *  - converge correction packet
 *  - compile artifacts carry the correction workflow (+ opt-in hooks)
 */

let repo: string;

function run(
  args: string[],
  opts: { expectFail?: boolean; env?: Record<string, string | undefined> } = {}
): string {
  try {
    return execFileSync(process.execPath, [CLI, ...args], {
      cwd: repo,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
    });
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    if (opts.expectFail) return (err.stdout ?? "") + (err.stderr ?? "");
    throw new Error(
      `CLI failed (${err.status}): converge ${args.join(" ")}\n${err.stdout}\n${err.stderr}`
    );
  }
}

function runJson(args: string[], env?: Record<string, string | undefined>): any {
  const out = run(args, { expectFail: true, env });
  const start = out.indexOf("{");
  const end = out.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error(`no JSON in output:\n${out}`);
  return JSON.parse(out.slice(start, end + 1));
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}

function write(rel: string, content: string): void {
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function read(rel: string): string {
  return fs.readFileSync(path.join(repo, rel), "utf8");
}

const FILES: Record<string, string> = {
  "package.json": JSON.stringify(
    { name: "fixture", private: true, type: "module", scripts: { test: "node --test" } },
    null,
    2
  ),
  // test command with a deliberate side effect: writes coverage.tmp at repo root
  "run-tests.cjs": `const fs = require("fs");
const { spawnSync } = require("child_process");
fs.writeFileSync("coverage.tmp", "coverage data");
const r = spawnSync(process.execPath, ["--test"], { stdio: "inherit" });
process.exit(r.status ?? 1);
`,
  "src/db/client.js": `const USERS = new Map([["alice@example.com", { email: "alice@example.com", password: "pw", name: "Alice" }]]);
export function getUserByEmail(email) { return USERS.get(email) ?? null; }
`,
  "src/service/auth.js": `import { getUserByEmail } from "../db/client.js";
export function login(email, password) {
  const user = getUserByEmail(email);
  if (!user || user.password !== password) return { ok: false };
  return { ok: true, name: user.name };
}
`,
  "src/ui/auth.js": `import { login } from "../service/auth.js";
export function renderLogin(email, password) {
  const result = login(email, password);
  return result.ok ? \`Welcome, \${result.name}!\` : "Login failed.";
}
`,
  "tests/auth.test.js": `import { test } from "node:test";
import assert from "node:assert/strict";
import { renderLogin } from "../src/ui/auth.js";
test("login ok", () => { assert.equal(renderLogin("alice@example.com", "pw"), "Welcome, Alice!"); });
test("login rejects bad password", () => { assert.equal(renderLogin("alice@example.com", "x"), "Login failed."); });
`,
};

const STRONG_ATTRACTOR = `version: 0.1
mode: product
project:
  name: fixture
attractor:
  dependency_direction:
    - id: ui-cannot-import-db
      from: "src/ui/**"
      cannot_import: "src/db/**"
      severity: error
verification:
  executed_by: converge
  before_close:
    - id: test
      command: "npm test"
      required: true
closure:
  require_fresh_audit: true
  allow_human_override: true
`;

// the "malicious PR" version: boundary rule deleted, verification command neutered
const WEAKENED_ATTRACTOR = `version: 0.1
mode: product
project:
  name: fixture
verification:
  executed_by: converge
  before_close:
    - id: test
      command: "node -e \\"process.exit(0)\\""
      required: true
closure:
  require_fresh_audit: true
  allow_human_override: true
`;

const VIOLATING_UI = `import { getUserByEmail } from "../db/client.js";
export function renderLogin(email, password) {
  const user = getUserByEmail(email.toLowerCase());
  if (!user || user.password !== password) return "Login failed.";
  return \`Welcome, \${user.name}!\`;
}
`;

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "convergekit-trust-"));
  for (const [rel, content] of Object.entries(FILES)) write(rel, content);
  write(".converge/attractor.yml", STRONG_ATTRACTOR);
  git(["init", "-q", "-b", "master"]);
  git(["config", "user.name", "test"]);
  git(["config", "user.email", "test@test"]);
  git(["add", "-A"]);
  git(["commit", "-qm", "baseline"]);

  // PR branch 1: weaken the gate config AND violate the boundary
  git(["checkout", "-qb", "pr-weaken"]);
  write(".converge/attractor.yml", WEAKENED_ATTRACTOR);
  write("src/ui/auth.js", VIOLATING_UI);
  git(["add", "-A"]);
  git(["commit", "-qm", "malicious: weaken gate + violate boundary"]);

  // PR branch 2: touches ONLY the attractor config (no code change)
  git(["checkout", "-q", "master"]);
  git(["checkout", "-qb", "pr-config-only"]);
  write(".converge/attractor.yml", STRONG_ATTRACTOR + "# tuned thresholds\n");
  git(["add", "-A"]);
  git(["commit", "-qm", "config-only change"]);

  git(["checkout", "-q", "master"]);
  // simulate a fetched remote so --base auto can resolve origin/master
  git(["remote", "add", "origin", repo]);
  git(["fetch", "-q", "origin"]);
});

afterAll(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe("CI trust boundary: --config-from-base", () => {
  it("still blocks boundary drift when the PR head weakened the attractor", () => {
    git(["checkout", "-q", "pr-weaken"]);
    const report = runJson(["check", "--json", "--base", "master", "--config-from-base", "master"]);
    expect(report.status).toBe("blocked");
    expect(report.configSource).toBe("master:.converge/attractor.yml");
    const boundary = report.checks.find((c: any) => c.id === "ui-cannot-import-db");
    expect(boundary.result).toBe("failed");
  });

  it("executes the verification command from the base branch, not the PR head", () => {
    const report = runJson(["check", "--json", "--base", "master", "--config-from-base", "master"]);
    const testEv = report.behaviorEvidence.find((e: any) => e.id === "test");
    expect(testEv.command).toBe("npm test"); // NOT node -e "process.exit(0)"
    expect(testEv.executed).toBe(true);
  });

  it("without --config-from-base the weakened config wins the rules, but the config change itself is flagged", () => {
    const report = runJson(["check", "--json", "--base", "master"]);
    // the deleted boundary rule is gone → drift invisible to the head config...
    expect(report.checks.find((c: any) => c.id === "ui-cannot-import-db")).toBeUndefined();
    const testEv = report.behaviorEvidence.find((e: any) => e.id === "test");
    expect(testEv.command).toContain("process.exit(0)");
    // ...but attractor-config-modified still blocks the bypass
    const flag = report.checks.find((c: any) => c.id === "attractor-config-modified");
    expect(flag.result).toBe("failed");
    expect(report.status).toBe("blocked");
  });

  it("flags attractor changes as failed (human approval required)", () => {
    const report = runJson(["check", "--json", "--base", "master", "--config-from-base", "master"]);
    const flag = report.checks.find((c: any) => c.id === "attractor-config-modified");
    expect(flag.result).toBe("failed");
    expect(flag.severity).toBe("error");
    expect(flag.evidence).toContain(".converge/attractor.yml");
  });

  it("resolves --base auto / --config-from-base auto from GITHUB_BASE_REF", () => {
    const report = runJson(
      ["check", "--json", "--base", "auto", "--config-from-base", "auto"],
      { GITHUB_BASE_REF: "master" }
    );
    expect(report.diff.base).toBe("origin/master");
    expect(report.configSource).toBe("origin/master:.converge/attractor.yml");
    const boundary = report.checks.find((c: any) => c.id === "ui-cannot-import-db");
    expect(boundary.result).toBe("failed");
  });

  it("fails loudly when --base auto has no GITHUB_BASE_REF", () => {
    const out = run(["check", "--base", "auto"], {
      expectFail: true,
      env: { GITHUB_BASE_REF: undefined },
    });
    expect(out).toMatch(/GITHUB_BASE_REF/);
  });

  it("audit judges a config-only PR as NEEDS HUMAN DECISION (not plain not-closed)", () => {
    git(["checkout", "-q", "pr-config-only"]);
    const out = run(
      ["audit", "--fresh", "--no-llm", "--base", "master", "--config-from-base", "master"],
      { expectFail: true }
    );
    expect(out).toMatch(/NEEDS HUMAN DECISION/i);
    const audit = JSON.parse(read(".converge/reports/adhoc/audit.json"));
    expect(audit.judgment).toBe("needs_human_decision");
    git(["checkout", "-q", "pr-weaken"]);
  });
});

describe("correction packet", () => {
  it("turns a blocked check into structured repair instructions", () => {
    git(["checkout", "-q", "pr-weaken"]);
    runJson(["check", "--json", "--base", "master", "--config-from-base", "master"]);
    const out = run(["correction"]);
    expect(out).toContain("# ConvergeKit Correction Packet");
    expect(out).toContain("Blocked.");
    expect(out).toContain("ui-cannot-import-db");
    expect(out).toContain("Allowed repair direction");
    expect(out).toContain("converge check");
    expect(out).toContain("Do Not");
    expect(fs.existsSync(path.join(repo, ".converge", "reports", "adhoc", "correction.md"))).toBe(
      true
    );
  });

  it("--for claude/codex adjust framing but keep the same facts", () => {
    const claude = run(["correction", "--for", "claude"]);
    const codex = run(["correction", "--for", "codex"]);
    expect(claude).toContain("For Claude Code");
    expect(codex).toContain("For Codex");
    for (const doc of [claude, codex]) {
      expect(doc).toContain("ui-cannot-import-db");
      expect(doc).toContain("attractor-config-modified");
    }
  });
});

describe("test-revert-rerun safety", () => {
  beforeAll(() => {
    git(["checkout", "-q", "master"]);
    // this fixture's gate runs the side-effect-producing test command
    write(
      ".converge/attractor.yml",
      STRONG_ATTRACTOR.replace('command: "npm test"', 'command: "node run-tests.cjs"')
    );
    git(["add", "-A"]);
    git(["commit", "-qm", "use side-effect test command"]);
  });

  it("reports side-effect files created by the test command", () => {
    // benign test edit so revert-rerun actually runs
    write("tests/auth.test.js", FILES["tests/auth.test.js"] + "// touched\n");
    const report = runJson(["check", "--json"]);
    git(["checkout", "-q", "--", "tests"]);
    const side = report.checks.find((c: any) => c.id === "working-tree-side-effects");
    expect(side.result).toBe("warning");
    expect(side.evidence).toContain("coverage.tmp");
    // restore of the reverted test files is verified
    const restore = report.checks.find((c: any) => c.id === "test-revert-restore");
    expect(restore.result).toBe("passed");
    const rr = report.checks.find((c: any) => c.id === "test-revert-rerun");
    expect(rr.result).toBe("passed");
    fs.rmSync(path.join(repo, "coverage.tmp"), { force: true });
  });

  it("blocks weakened tests in isolated mode without touching the working tree", () => {
    write("src/ui/auth.js", FILES["src/ui/auth.js"].replace("Welcome, ", "Hello, "));
    write(
      "tests/auth.test.js",
      FILES["tests/auth.test.js"].replace(/Welcome, Alice!/g, "Hello, Alice!")
    );
    const report = runJson(["check", "--json", "--test-integrity-mode", "isolated"]);
    const testFileAfter = read("tests/auth.test.js");
    git(["checkout", "-q", "--", "src", "tests"]);
    fs.rmSync(path.join(repo, "coverage.tmp"), { force: true });

    expect(report.status).toBe("blocked");
    const rr = report.checks.find((c: any) => c.id === "test-revert-rerun");
    expect(rr.result).toBe("failed");
    expect(rr.evidence).toContain("isolated");
    // the working tree was never mutated by the isolated revert-rerun
    expect(testFileAfter).toContain("Hello, Alice!");
    expect(report.checks.find((c: any) => c.id === "test-revert-restore")).toBeUndefined();
  });

  it("rejects an unknown --test-integrity-mode", () => {
    const out = run(["check", "--test-integrity-mode", "yolo"], { expectFail: true });
    expect(out).toMatch(/test-integrity-mode/);
  });
});

describe("verifyRestoredFiles (restore failure must be detectable)", () => {
  it("detects missing, mutated and resurrected files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "convergekit-restore-"));
    try {
      fs.writeFileSync(path.join(dir, "kept.txt"), "same");
      fs.writeFileSync(path.join(dir, "mutated.txt"), "changed on disk");
      fs.writeFileSync(path.join(dir, "ghost.txt"), "should be gone");
      const backups = new Map<string, string | null>([
        ["kept.txt", "same"],
        ["mutated.txt", "original"],
        ["missing.txt", "was here"],
        ["ghost.txt", null],
      ]);
      const problems = verifyRestoredFiles(dir, backups);
      expect(problems.some((p) => p.startsWith("mutated.txt"))).toBe(true);
      expect(problems.some((p) => p.startsWith("missing.txt"))).toBe(true);
      expect(problems.some((p) => p.startsWith("ghost.txt"))).toBe(true);
      expect(problems.some((p) => p.startsWith("kept.txt"))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("compile carries the correction workflow", () => {
  it("CLAUDE.md / AGENTS.md / skills mention correction; --with-hooks generates the stop hook", () => {
    run(["compile", "--all"]);
    run(["compile", "--target", "claude", "--with-hooks"]);

    expect(read("CLAUDE.md")).toContain("converge correction");
    expect(read("AGENTS.md")).toContain("Correction Packet");
    expect(fs.existsSync(path.join(repo, ".claude", "skills", "converge-correction", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(repo, ".codex", "skills", "converge-correction", "SKILL.md"))).toBe(true);

    const hook = read(".claude/hooks/converge-stop-check.sh");
    expect(hook).toContain("converge check --no-exec --json");
    expect(hook).toContain("stop_hook_active");
    const settings = JSON.parse(read(".claude/settings.json"));
    expect(JSON.stringify(settings.hooks.Stop)).toContain("converge-stop-check");

    // idempotent: recompiling must not duplicate the hook entry
    run(["compile", "--target", "claude", "--with-hooks"]);
    const settings2 = JSON.parse(read(".claude/settings.json"));
    expect(settings2.hooks.Stop.length).toBe(settings.hooks.Stop.length);

    // cleanup generated artifacts on the fixture branch
    git(["checkout", "-q", "--", "."]);
  });
});
