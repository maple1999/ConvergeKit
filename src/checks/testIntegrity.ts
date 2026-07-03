import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import picomatch from "picomatch";
import type { AttractorConfig, VerificationCommand } from "../lib/config.js";
import { testFileGlobs } from "../lib/config.js";
import type { DiffSummary } from "../lib/git.js";
import {
  getFileAt,
  getDiffTextFor,
  resolveCommit,
  addWorktree,
  removeWorktree,
} from "../lib/git.js";
import { runCommand } from "../lib/exec.js";
import type { Finding } from "../lib/report.js";

export type TestIntegrityMode = "in-place" | "isolated";

export interface TestIntegrityOptions {
  /** test command used for revert-rerun; taken from verification config */
  testCommand: VerificationCommand | null;
  /** skip the (expensive) revert-rerun, e.g. when no test command exists */
  runRevertRerun: boolean;
  /** in-place (default): revert in the working tree with restore verification; isolated: temp git worktree */
  mode?: TestIntegrityMode;
  /** commands run inside the isolated worktree before tests (verification.setup_for_isolated) */
  setupCommands?: string[];
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
 * Safety: in-place mode snapshots test files before reverting and verifies the
 * restore byte-for-byte afterwards; a failed restore fails the check instead
 * of silently continuing. Isolated mode runs the whole revert-rerun inside a
 * temporary detached git worktree and never touches the working tree.
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
    const mode = opts.mode ?? "in-place";
    if (mode === "isolated") {
      findings.push(
        ...revertRerunIsolated(root, diff, changedTests, opts.testCommand, opts.setupCommands ?? [])
      );
    } else {
      findings.push(...revertRerunInPlace(root, diff, changedTests, opts.testCommand));
    }
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

// ---------- in-place mode: revert in the working tree, verify restoration ----------

function revertRerunInPlace(
  root: string,
  diff: DiffSummary,
  changedTests: string[],
  testCommand: VerificationCommand
): Finding[] {
  // 1. run tests with the current (possibly weakened) tests
  const current = runCommand(testCommand.command, root);
  if (current.exitCode !== 0) {
    return [
      {
        id: "test-revert-rerun",
        severity: "error",
        result: "passed",
        evidence:
          "current tests already failing; weakening-to-pass not applicable (see verification evidence)",
      },
    ];
  }

  // 2. snapshot current test files, restore baseline versions
  const backups = new Map<string, string | null>();
  let rrFinding: Finding;
  let restoreError: string | null = null;
  try {
    for (const t of changedTests) {
      const abs = path.join(root, t);
      backups.set(t, fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null);
    }
    for (const t of changedTests) {
      const abs = path.join(root, t);
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
    rrFinding =
      baselineRun.exitCode !== 0
        ? {
            id: "test-revert-rerun",
            severity: "error",
            result: "failed",
            evidence:
              `tests pass with modified tests but FAIL with baseline tests (exit ${baselineRun.exitCode}).\n` +
              `implementation depends on weakened/adapted tests.\n` +
              `reverted test files: ${changedTests.join(", ")}`,
          }
        : {
            id: "test-revert-rerun",
            severity: "error",
            result: "passed",
            evidence: `tests pass with both modified and baseline test files (${changedTests.length} test file(s) checked)`,
          };
  } catch (e) {
    rrFinding = {
      id: "test-revert-rerun",
      severity: "error",
      result: "failed",
      evidence: `revert-rerun aborted: ${(e as Error).message}`,
    };
  } finally {
    // 4. always restore the working tree
    try {
      for (const [t, content] of backups) {
        const abs = path.join(root, t);
        if (content === null) {
          if (fs.existsSync(abs)) fs.rmSync(abs);
        } else {
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, content, "utf8");
        }
      }
    } catch (e) {
      restoreError = `restore threw: ${(e as Error).message}`;
    }
  }

  // 5. verify restoration byte-for-byte — a dirty restore must fail the check
  const problems = restoreError ? [restoreError] : verifyRestoredFiles(root, backups);
  const restoreFinding: Finding =
    problems.length > 0
      ? {
          id: "test-revert-restore",
          severity: "error",
          result: "failed",
          evidence:
            `test-revert-rerun left working tree dirty:\n${problems.join("\n")}\n` +
            `restore these files from your VCS/backup before continuing (e.g. git checkout -- <file>).`,
        }
      : {
          id: "test-revert-restore",
          severity: "error",
          result: "passed",
          evidence: `working tree restored and verified (${backups.size} test file(s))`,
        };
  return [rrFinding, restoreFinding];
}

/** Compare each backed-up test file with the on-disk state; returns human-readable mismatches. */
export function verifyRestoredFiles(root: string, backups: Map<string, string | null>): string[] {
  const problems: string[] = [];
  for (const [t, content] of backups) {
    const abs = path.join(root, t);
    if (content === null) {
      if (fs.existsSync(abs)) problems.push(`${t}: should not exist after restore, but does`);
      continue;
    }
    let disk: string | null;
    try {
      disk = fs.readFileSync(abs, "utf8");
    } catch {
      disk = null;
    }
    if (disk === null) problems.push(`${t}: missing after restore`);
    else if (disk !== content) problems.push(`${t}: content differs from pre-check backup`);
  }
  return problems;
}

// ---------- isolated mode: temp git worktree, working tree untouched ----------

function revertRerunIsolated(
  root: string,
  diff: DiffSummary,
  changedTests: string[],
  testCommand: VerificationCommand,
  setupCommands: string[]
): Finding[] {
  const fail = (evidence: string): Finding[] => [
    { id: "test-revert-rerun", severity: "error", result: "failed", evidence },
  ];

  const baseCommit = resolveCommit(root, diff.base);
  if (!baseCommit) {
    return fail(
      `isolated mode: cannot resolve diff base "${diff.base}" to a commit; use --base <ref> or in-place mode`
    );
  }

  // worktree path must not pre-exist: older gits refuse existing (even empty) dirs
  const tmpParent = fs.mkdtempSync(path.join(os.tmpdir(), "convergekit-isolated-"));
  const tmp = path.join(tmpParent, "wt");
  let worktreeAdded = false;
  try {
    addWorktree(root, tmp, baseCommit);
    worktreeAdded = true;

    // replicate the current working tree state for every changed file
    for (const f of diff.files) {
      const src = path.join(root, f.path);
      const dst = path.join(tmp, f.path);
      if (f.status === "D" || !fs.existsSync(src)) {
        if (fs.existsSync(dst)) fs.rmSync(dst);
      } else {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
      }
    }

    // dependencies: link node_modules if present (junction works without admin on Windows)
    const rootNm = path.join(root, "node_modules");
    const tmpNm = path.join(tmp, "node_modules");
    if (fs.existsSync(rootNm) && !fs.existsSync(tmpNm)) {
      try {
        fs.symlinkSync(rootNm, tmpNm, "junction");
      } catch {
        /* setup_for_isolated commands may install dependencies instead */
      }
    }
    for (const cmd of setupCommands) {
      const setup = runCommand(cmd, tmp);
      if (setup.exitCode !== 0) {
        return fail(
          `isolated mode: setup command failed (exit ${setup.exitCode}): ${cmd}\nfix verification.setup_for_isolated or use in-place mode`
        );
      }
    }

    // 1. current tests inside the isolated copy
    const current = runCommand(testCommand.command, tmp);
    if (current.exitCode !== 0) {
      // Cannot fall through as "not applicable": if the working-tree run passes while the
      // isolated run fails, a weakened test suite would slip through unvalidated.
      return fail(
        `isolated mode: tests FAIL in the isolated copy (exit ${current.exitCode}).\n` +
          `either the change does not pass its own tests, or the isolated environment is incomplete\n` +
          `(configure verification.setup_for_isolated, e.g. "npm ci", or use --test-integrity-mode in-place).`
      );
    }

    // 2. revert test files to the diff base inside the worktree
    for (const t of changedTests) {
      const abs = path.join(tmp, t);
      const baseline = getFileAt(root, diff.base, t);
      if (baseline === null) {
        if (fs.existsSync(abs)) fs.rmSync(abs);
      } else {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, baseline, "utf8");
      }
    }

    // 3. re-run against baseline tests
    const baselineRun = runCommand(testCommand.command, tmp);
    if (baselineRun.exitCode !== 0) {
      return fail(
        `tests pass with modified tests but FAIL with baseline tests (exit ${baselineRun.exitCode}) [isolated worktree].\n` +
          `implementation depends on weakened/adapted tests.\n` +
          `reverted test files: ${changedTests.join(", ")}`
      );
    }
    return [
      {
        id: "test-revert-rerun",
        severity: "error",
        result: "passed",
        evidence: `tests pass with both modified and baseline test files (${changedTests.length} test file(s), isolated worktree; working tree untouched)`,
      },
    ];
  } catch (e) {
    return fail(`isolated mode error: ${(e as Error).message}`);
  } finally {
    if (worktreeAdded) removeWorktree(root, tmp);
    fs.rmSync(tmpParent, { recursive: true, force: true });
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
