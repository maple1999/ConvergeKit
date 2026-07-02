import { describe, it, expect } from "vitest";
import { extractImportSpecifiers } from "../src/checks/boundary.js";
import { computeClosure } from "../src/lib/report.js";
import { parseJudgment } from "../src/commands/audit.js";

describe("import specifier extraction", () => {
  it("extracts static imports", () => {
    const src = `import { a } from "./x.js";\nimport b from '../y';\nimport "./side-effect";`;
    expect(extractImportSpecifiers(src)).toEqual(["./x.js", "../y", "./side-effect"]);
  });

  it("extracts require and dynamic import", () => {
    const src = `const a = require("./x");\nconst b = await import("../db/client.js");`;
    expect(extractImportSpecifiers(src)).toEqual(["./x", "../db/client.js"]);
  });

  it("extracts re-exports", () => {
    const src = `export { a } from "./mod.js";`;
    expect(extractImportSpecifiers(src)).toContain("./mod.js");
  });
});

describe("closure computation", () => {
  const base = {
    plan: "PLAN-001",
    mode: "product",
    generatedAt: "",
    commit: "",
    diff: { base: "HEAD", changedFiles: 0, addedLines: 0, deletedLines: 0, files: [] },
  };

  it("blocks on error-severity failed checks", () => {
    const { status, closure } = computeClosure({
      ...base,
      behaviorEvidence: [],
      checks: [{ id: "boundary", severity: "error", result: "failed", evidence: "x imports y" }],
    });
    expect(status).toBe("blocked");
    expect(closure.allowed).toBe(false);
    expect(closure.blockers[0]).toMatch(/boundary/);
  });

  it("does not block on advisory findings", () => {
    const { status, closure } = computeClosure({
      ...base,
      behaviorEvidence: [],
      checks: [
        { id: "heur", severity: "advisory", result: "advisory", evidence: "assertions removed" },
      ],
    });
    expect(status).toBe("passed");
    expect(closure.allowed).toBe(true);
  });

  it("blocks when a required verification was not executed", () => {
    const { closure } = computeClosure({
      ...base,
      behaviorEvidence: [
        {
          id: "test",
          command: "npm test",
          required: true,
          executed: false,
          exitCode: null,
          outputHash: null,
          startedAt: null,
          durationMs: null,
        },
      ],
      checks: [],
    });
    expect(closure.allowed).toBe(false);
    expect(closure.blockers[0]).toMatch(/not executed/);
  });

  it("blocks when a required verification failed", () => {
    const { closure } = computeClosure({
      ...base,
      behaviorEvidence: [
        {
          id: "test",
          command: "npm test",
          required: true,
          executed: true,
          exitCode: 1,
          outputHash: "abc",
          startedAt: "",
          durationMs: 1,
        },
      ],
      checks: [],
    });
    expect(closure.allowed).toBe(false);
    expect(closure.blockers[0]).toMatch(/failed/);
  });

  it("warnings do not block", () => {
    const { status, closure } = computeClosure({
      ...base,
      behaviorEvidence: [],
      checks: [{ id: "scope", severity: "warning", result: "warning", evidence: "broad diff" }],
    });
    expect(status).toBe("warnings");
    expect(closure.allowed).toBe(true);
    expect(closure.warnings.length).toBe(1);
  });
});

describe("LLM audit judgment parsing", () => {
  it("parses a clean JSON response", () => {
    const j = parseJudgment(
      `{"judgment":"not_closed","blockers":["b1"],"warnings":[],"evidence_reviewed":["diff"],"false_positive_risks":[],"next_actions":["rework"]}`
    );
    expect(j?.judgment).toBe("not_closed");
    expect(j?.blockers).toEqual(["b1"]);
  });

  it("extracts JSON embedded in prose", () => {
    const j = parseJudgment(
      `Here is my audit:\n\n{"judgment":"closed","blockers":[]}\n\nThanks.`
    );
    expect(j?.judgment).toBe("closed");
  });

  it("returns null for garbage", () => {
    expect(parseJudgment("no json here")).toBeNull();
  });

  it("normalizes unknown judgment values", () => {
    const j = parseJudgment(`{"judgment":"maybe","blockers":[]}`);
    expect(j?.judgment).toBe("needs_human_decision");
  });
});
