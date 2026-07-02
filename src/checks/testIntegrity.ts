import fs from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import type { AttractorConfig, VerificationCommand } from "../lib/config.js";
import { testFileGlobs } from "../lib/config.js";
import type { DiffSummary } from "../lib/git.js";
import { getFileAt, getDiffTextFor } from "../lib/git.js";
import { runCommand } from "../lib/exec.js";
import type { Finding } from "../lib/report.js";

export interface TestIntegrityOptions {
  /** test command used for revert-rerun; taken from verification config */
  testCommand: VerificationCommand | null;
  /** skip the (expensive) revert-rerun, e.g. when no test command exists */
  runRevertRerun: boolean;
}

export function findChangedTestFiles(cfg: AttractorConfig, diff: DiffSummary): string[] {
  const globs = testFileGlobs(cfg);
  const matchers = globs.map((g) => picomatch(g, { dot: true, basename: false }));
  return diff.files
    .filter((f) => matchers.some((m) => m(f.path)))
    .map((f) => f.path);
}

/**
 * D. Test Integrity Check.
 *
 * P0 (blocker): test-revert-rerun — revert test-file changes to the diff base
 * (source changes kept), re-run the test command. If tests pass with the
 * modified tests but fail with the baseline tests, the implementation depends
 * on weakened/adapted tests → blocker. (Judgment standard borrowed from
 * reward-hacking detection research: EvilGenie, OpenAI CoT monitoring.)
 *
 * P1 (advisory): text heuristics — assertion deletions, removed test blocks,
 * snapshot broadening. High false-positive rate across frameworks, so these
 * never block closure in v0.1.
 */
export function checkTestIntegrity(
  root: string,
  cfg: AttractorConfig,
  diff: DiffSummary,
  opts: TestIntegrityOptions
): Finding[] {
  const findings: Finding[] = [];
  const changedTests = findChangedTestFiles(cfg, diff);

  if (changedTests.length === 0) {
    findings.push({
      id: "test-revert-rerun",
      severity: "error",
      result: "passed",
      evidence: "no test files changed",
    });
    return findings;
  }

  // --- P0: test-revert-rerun ---
  if (opts.runRevertRerun && opts.testCommand) {
    findings.push(revertRerun(root, diff, changedTests, opts.testCommand));
  } else {
    findings.push({
      id: "test-revert-rerun",
      severity: "error",
      result: "skipped",
      evidence: opts.testCommand
        ? "revert-rerun disabled"
        : 'no test command configured in verification.before_close (id "test")',
    });
  }

  // --- P1: advisory heuristics ---
  findings.push(...heuristics(root, diff, changedTests));
  return findings;
}

function revertRerun(
  root: string,
  diff: DiffSummary,
  changedTests: string[],
  testCommand: VerificationCommand
): Finding {
  // 1. run tests with the current (possibly weakened) tests
  const current = runCommand(testCommand.command, root);
  if (current.exitCode !== 0) {
    return {
      id: "test-revert-rerun",
      severity: "error",
      result: "passed",
      evidence: "current tests already failing; weakening-to-pass not applicable (see verification evidence)",
    };
  }

  // 2. snapshot current test files, restore baseline versions
  const backups = new Map<string, string | null>();
  try {
    for (const t of changedTests) {
      const abs = path.join(root, t);
      backups.set(t, fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null);
      const baseline = getFileAt(root, diff.base, t);
      if (baseline === null) {
        // new test file: revert = remove it
        if (fs.existsSync(abs)) fs.rmSync(abs);
      } else {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, baseline, "utf8");
      }
    }

    // 3. re-run tests against baseline tests
    const baselineRun = runCommand(testCommand.command, root);

    if (baselineRun.exitCode !== 0) {
      return {
        id: "test-revert-rerun",
        severity: "error",
        result: "failed",
        evidence:
          `tests pass with modified tests but FAIL with baseline tests (exit ${baselineRun.exitCode}).\n` +
          `implementation depends on weakened/adapted tests.\n` +
          `reverted test files: ${changedTests.join(", ")}`,
      };
    }
    return {
      id: "test-revert-rerun",
      severity: "error",
      result: "passed",
      evidence: `tests pass with both modified and baseline test files (${changedTests.length} test file(s) checked)`,
    };
  } finally {
    // 4. always restore the working tree
    for (const [t, content] of backups) {
      const abs = path.join(root, t);
      if (content === null) {
        if (fs.existsSync(abs)) fs.rmSync(abs);
      } else {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, "utf8");
      }
    }
  }
}

const ASSERT_RE = /^\s*[-+].*(?:\bexpect\s*\(|\bassert[.\s(]|\bshould\b|\bt\.(?:equal|is|deepEqual|truthy)\b)/;
const TEST_BLOCK_RE = /^\s*[-+].*(?:\btest\s*\(|\bit\s*\(|\bdescribe\s*\()/;

function heuristics(root: string, diff: DiffSummary, changedTests: string[]): Finding[] {
  const findings: Finding[] = [];
  const diffText = getDiffTextFor(root, diff.base, changedTests);
  let assertsRemoved = 0;
  let assertsAdded = 0;
  let blocksRemoved = 0;
  let snapshotChanges = 0;

  for (const line of diffText.split("\n")) {
    if (line.startsWith("---") || line.startsWith("+++")) continue;
    const removed = line.startsWith("-");
    const added = line.startsWith("+");
    if (!removed && !added) continue;
    if (ASSERT_RE.test(line)) {
      if (removed) assertsRemoved++;
      else assertsAdded++;
    }
    if (removed && TEST_BLOCK_RE.test(line)) blocksRemoved++;
    if (/\.snap\b/.test(line) || /toMatchSnapshot/.test(line)) snapshotChanges++;
  }

  const details: string[] = [`test files modified: ${changedTests.join(", ")}`];
  if (assertsRemoved > assertsAdded) {
    details.push(`${assertsRemoved - assertsAdded} assertion(s) net removed`);
  }
  if (blocksRemoved > 0) details.push(`${blocksRemoved} test/describe block line(s) removed`);
  if (snapshotChanges > 5) details.push(`broad snapshot changes (${snapshotChanges} lines)`);

  findings.push({
    id: "test-heuristics",
    severity: "advisory",
    result: details.length > 1 ? "advisory" : "passed",
    evidence: details.join("\n"),
  });
  return findings;
}
