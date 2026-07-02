import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CLI = path.resolve(__dirname, "..", "dist", "cli.js");

let repo: string;

function run(args: string[], opts: { expectFail?: boolean } = {}): string {
  try {
    return execFileSync(process.execPath, [CLI, ...args], {
      cwd: repo,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    if (opts.expectFail) return (err.stdout ?? "") + (err.stderr ?? "");
    throw new Error(
      `CLI failed (${err.status}): converge ${args.join(" ")}\n${err.stdout}\n${err.stderr}`
    );
  }
}

/** Run `converge <args>` and parse the JSON report regardless of exit code. */
function runJson(args: string[]): any {
  const out = run(args, { expectFail: true });
  const start = out.indexOf("{");
  const end = out.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error(`no JSON in output:\n${out}`);
  return JSON.parse(out.slice(start, end + 1));
}

function git(args: string[]): void {
  execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}

function write(rel: string, content: string): void {
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

const FILES: Record<string, string> = {
  "package.json": JSON.stringify(
    { name: "fixture", private: true, type: "module", scripts: { test: "node --test" } },
    null,
    2
  ),
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

const ATTRACTOR = `version: 0.1
mode: product
project:
  name: fixture
attractor:
  dependency_direction:
    - id: ui-cannot-import-db
      from: "src/ui/**"
      cannot_import: "src/db/**"
      severity: error
  forbidden_paths:
    - path: ".env"
      severity: error
verification:
  executed_by: converge
  before_close:
    - id: test
      command: "npm test"
      required: true
closure:
  require_fresh_audit: true
  require_plan_exit_criteria: true
  allow_human_override: true
`;

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "convergekit-e2e-"));
  for (const [rel, content] of Object.entries(FILES)) write(rel, content);
  git(["init", "-q"]);
  git(["config", "user.name", "test"]);
  git(["config", "user.email", "test@test"]);
  run(["init", "-y"]);
  write(".converge/attractor.yml", ATTRACTOR); // deterministic fixture attractor
  git(["add", "-A"]);
  git(["commit", "-qm", "baseline"]);
});

afterAll(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe("end-to-end: converge on a real git fixture", () => {
  it("init created the .converge structure", () => {
    expect(fs.existsSync(path.join(repo, ".converge", "attractor.yml"))).toBe(true);
    expect(fs.existsSync(path.join(repo, "docs", "plans"))).toBe(true);
    expect(fs.existsSync(path.join(repo, ".converge", "memory", "disproven-assumptions"))).toBe(true);
  });

  it("plan creates a numbered plan and sets it active", () => {
    const out = run(["plan", "fix login", "--type", "bugfix"]);
    expect(out).toMatch(/PLAN-001/);
    git(["add", "-A"]);
    git(["commit", "-qm", "plan"]);
  });

  it("check passes on a clean working tree", () => {
    const report = runJson(["check", "--json"]);
    expect(report.status).not.toBe("blocked");
    expect(report.closure.allowed).toBe(true);
  });

  it("BLOCKS when tests pass but UI imports DB (architecture drift)", () => {
    write(
      "src/ui/auth.js",
      `import { getUserByEmail } from "../db/client.js";
export function renderLogin(email, password) {
  const user = getUserByEmail(email.toLowerCase());
  if (!user || user.password !== password) return "Login failed.";
  return \`Welcome, \${user.name}!\`;
}
`
    );
    const report = runJson(["check", "--json"]);
    git(["checkout", "--", "src"]); // clean up before asserting
    expect(report.status).toBe("blocked");
    const boundary = report.checks.find((c: { id: string }) => c.id === "ui-cannot-import-db");
    expect(boundary.result).toBe("failed");
    // the tests themselves passed — that is the whole point
    const testEv = report.behaviorEvidence.find((e: { id: string }) => e.id === "test");
    expect(testEv.exitCode).toBe(0);
  });

  it("BLOCKS via test-revert-rerun when tests are adapted to the implementation", () => {
    // behavior change + tests adapted to match → current tests pass
    write(
      "src/ui/auth.js",
      FILES["src/ui/auth.js"].replace("Welcome, ", "Hello, ")
    );
    write(
      "tests/auth.test.js",
      FILES["tests/auth.test.js"].replace(/Welcome, Alice!/g, "Hello, Alice!")
    );
    const report = runJson(["check", "--json"]);
    // working tree must be restored by converge after revert-rerun
    const restored = fs.readFileSync(path.join(repo, "tests", "auth.test.js"), "utf8");
    git(["checkout", "--", "src", "tests"]); // clean up before asserting
    expect(report.status).toBe("blocked");
    const rr = report.checks.find((c: { id: string }) => c.id === "test-revert-rerun");
    expect(rr.result).toBe("failed");
    expect(restored).toContain("Hello, Alice!");
  });

  it("forbidden path modification is blocked", () => {
    write(".env", "SECRET=1");
    git(["add", ".env"]); // untracked files don't show in git diff; stage it
    const report = runJson(["check", "--json"]);
    git(["rm", "-fq", "--cached", ".env"]);
    fs.rmSync(path.join(repo, ".env"));
    const fp = report.checks.find((c: { id: string }) => c.id.startsWith("forbidden-path:.env"));
    expect(fp.result).toBe("failed");
  });

  it("clean fix: check → audit --no-llm → close succeeds", () => {
    // legitimate fix in the service layer
    write(
      "src/service/auth.js",
      FILES["src/service/auth.js"].replace("getUserByEmail(email)", "getUserByEmail(email.toLowerCase())")
    );
    // fill exit criteria
    const planFile = fs
      .readdirSync(path.join(repo, "docs", "plans"))
      .find((f) => f.startsWith("PLAN-001"))!;
    const planPath = path.join(repo, "docs", "plans", planFile);
    fs.writeFileSync(
      planPath,
      fs
        .readFileSync(planPath, "utf8")
        .replace("- [ ] ...", "- [x] uppercase emails can log in")
    );

    const checkReport = runJson(["check", "--json"]);
    expect(checkReport.closure.allowed).toBe(true);

    const auditOut = run(["audit", "--fresh", "--no-llm"]);
    expect(auditOut).toMatch(/CLOSED/i);
    expect(fs.existsSync(path.join(repo, ".converge", "reports", "PLAN-001", "evidence-pack.md"))).toBe(true);

    const closeOut = run(["close", "PLAN-001"]);
    expect(closeOut).toMatch(/PLAN-001 closed/);
    expect(fs.existsSync(path.join(repo, ".converge", "handoff.md"))).toBe(true);
  });

  it("close refuses a plan with unresolved blockers", () => {
    run(["plan", "second task", "--type", "bugfix"]);
    const out = run(["close", "PLAN-002"], { expectFail: true });
    expect(out).toMatch(/Cannot close PLAN-002/);
  });

  it("compile generates agent configs from the attractor", () => {
    run(["compile", "--all"]);
    for (const f of ["CLAUDE.md", "AGENTS.md", ".clinerules", ".opencode/instructions.md"]) {
      expect(fs.existsSync(path.join(repo, f))).toBe(true);
    }
    const claude = fs.readFileSync(path.join(repo, "CLAUDE.md"), "utf8");
    expect(claude).toContain("ui-cannot-import-db");
    expect(claude).toContain("convergekit:generated:start");
    expect(fs.existsSync(path.join(repo, ".claude", "skills", "converge-audit", "SKILL.md"))).toBe(true);
  });

  it("memory add + handoff include trajectory records", () => {
    run(["memory", "add", "--type", "divergent-path", "--summary", "UI-layer fix diverges"]);
    const out = run(["handoff"]);
    expect(out).toMatch(/UI-layer fix diverges/);
    expect(out).toMatch(/PLAN-001: fix login/);
  });
});
