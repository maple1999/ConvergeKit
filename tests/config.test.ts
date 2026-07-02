import { describe, it, expect } from "vitest";
import { validateAttractor, ConfigError } from "../src/lib/config.js";

const minimal = { version: 0.1, mode: "product" };

describe("attractor.yml validation", () => {
  it("accepts a minimal product config", () => {
    expect(validateAttractor(minimal).mode).toBe("product");
  });

  it("rejects missing version", () => {
    expect(() => validateAttractor({ mode: "product" })).toThrow(ConfigError);
  });

  it("rejects missing mode", () => {
    expect(() => validateAttractor({ version: 1 })).toThrow(/mode/);
  });

  it("rejects research/venture modes in v0.1", () => {
    expect(() => validateAttractor({ version: 1, mode: "research" })).toThrow(/v0\.3/);
    expect(() => validateAttractor({ version: 1, mode: "venture" })).toThrow(/v0\.3/);
  });

  it("rejects invariants without id or rule", () => {
    expect(() =>
      validateAttractor({
        ...minimal,
        attractor: { invariants: [{ id: "x" }] },
      })
    ).toThrow(/invariant/);
  });

  it("rejects invalid severity", () => {
    expect(() =>
      validateAttractor({
        ...minimal,
        attractor: { invariants: [{ id: "x", rule: "r", severity: "fatal" }] },
      })
    ).toThrow(/severity/);
  });

  it("rejects dependency rules without cannot_import", () => {
    expect(() =>
      validateAttractor({
        ...minimal,
        attractor: { dependency_direction: [{ from: "a/**" }] },
      })
    ).toThrow(/cannot_import/);
  });

  it("rejects verification commands without command", () => {
    expect(() =>
      validateAttractor({
        ...minimal,
        verification: { before_close: [{ id: "test" }] },
      })
    ).toThrow(/verification/);
  });
});
