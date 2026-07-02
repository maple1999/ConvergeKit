import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parsePlan, slugify, nextPlanNumber } from "../src/lib/plans.js";
import { writeGenerated } from "../src/commands/compile.js";
import { inferDependencyRules } from "../src/commands/init.js";

let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "convergekit-test-"));
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const PLAN_MD = `# PLAN-001: fix login

<!-- plan-type: bugfix -->

## Status

Active

## Non-goals

- \`src/db/**\`
- keep the public API stable

## Exit Criteria

- [x] login works with uppercase email
- [ ] focused test added

## Notes
`;

describe("plan parsing", () => {
  it("parses status, type, non-goal paths and exit criteria", () => {
    const dir = path.join(tmp, "p1", "docs", "plans");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "PLAN-001-fix-login.md"), PLAN_MD);
    const plan = parsePlan(path.join(tmp, "p1"), "PLAN-001")!;
    expect(plan.status).toBe("Active");
    expect(plan.type).toBe("bugfix");
    expect(plan.nonGoalPaths).toEqual(["src/db/**"]);
    expect(plan.exitCriteria).toEqual([
      { text: "login works with uppercase email", checked: true },
      { text: "focused test added", checked: false },
    ]);
  });

  it("parses CRLF plan files (Windows editors)", () => {
    const dir = path.join(tmp, "p2", "docs", "plans");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "PLAN-001-crlf.md"), PLAN_MD.replace(/\n/g, "\r\n"));
    const plan = parsePlan(path.join(tmp, "p2"), "PLAN-001")!;
    expect(plan.exitCriteria.length).toBe(2);
    expect(plan.exitCriteria[0].checked).toBe(true);
    expect(plan.nonGoalPaths).toEqual(["src/db/**"]);
  });

  it("numbers plans sequentially", () => {
    const root = path.join(tmp, "p3");
    fs.mkdirSync(path.join(root, "docs", "plans"), { recursive: true });
    expect(nextPlanNumber(root)).toBe(1);
    fs.writeFileSync(path.join(root, "docs", "plans", "PLAN-007-x.md"), "# PLAN-007: x");
    expect(nextPlanNumber(root)).toBe(8);
  });

  it("slugifies titles", () => {
    expect(slugify("Fix Auth Bug (без drift)!")).toBe("fix-auth-bug-drift");
  });
});

describe("compile writeGenerated", () => {
  it("preserves manual content outside generated markers on recompile", () => {
    const root = path.join(tmp, "c1");
    fs.mkdirSync(root, { recursive: true });
    writeGenerated(root, "CLAUDE.md", "# Rules v1");
    const withManual =
      "# My notes\n\nkeep me\n\n" + fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8");
    fs.writeFileSync(path.join(root, "CLAUDE.md"), withManual);

    writeGenerated(root, "CLAUDE.md", "# Rules v2");
    const out = fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8");
    expect(out).toContain("keep me");
    expect(out).toContain("# Rules v2");
    expect(out).not.toContain("# Rules v1");
    expect(out.match(/convergekit:generated:start/g)?.length).toBe(1);
  });

  it("appends generated block below pre-existing manual files", () => {
    const root = path.join(tmp, "c2");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "CLAUDE.md"), "# Handwritten config\n");
    writeGenerated(root, "CLAUDE.md", "# Generated rules");
    const out = fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8");
    expect(out.startsWith("# Handwritten config")).toBe(true);
    expect(out).toContain("# Generated rules");
  });
});

describe("init invariant inference", () => {
  it("infers ui-cannot-import-db from directory structure", () => {
    const root = path.join(tmp, "i1");
    for (const d of ["src/ui", "src/db", "src/service"]) {
      fs.mkdirSync(path.join(root, d), { recursive: true });
    }
    const rules = inferDependencyRules(root);
    const ids = rules.map((r) => r.id);
    expect(ids).toContain("ui-cannot-import-db");
    expect(ids).toContain("service-cannot-import-ui");
  });

  it("infers nothing for unknown layouts", () => {
    const root = path.join(tmp, "i2");
    fs.mkdirSync(path.join(root, "src", "stuff"), { recursive: true });
    expect(inferDependencyRules(root)).toEqual([]);
  });
});
