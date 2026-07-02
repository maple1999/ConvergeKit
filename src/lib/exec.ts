import { spawnSync } from "node:child_process";
import crypto from "node:crypto";

export interface ExecResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  outputHash: string;
  startedAt: string;
  durationMs: number;
}

/**
 * Run a verification command via the shell, capturing everything ConvergeKit
 * needs as closure evidence: exit code, output, output hash, timestamps.
 * Evidence produced here is the only authoritative validation evidence —
 * pre-existing log files are advisory only (agents can fabricate logs).
 */
export function runCommand(command: string, cwd: string, timeoutMs = 10 * 60 * 1000): ExecResult {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const isWin = process.platform === "win32";
  const res = spawnSync(isWin ? "cmd.exe" : "sh", isWin ? ["/d", "/s", "/c", command] : ["-c", command], {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    windowsVerbatimArguments: isWin,
  });
  const stdout = res.stdout ?? "";
  const stderr = res.stderr ?? "";
  const exitCode = res.status ?? (res.error ? -1 : 0);
  const outputHash = crypto
    .createHash("sha256")
    .update(stdout)
    .update(stderr)
    .digest("hex");
  return {
    command,
    exitCode,
    stdout,
    stderr,
    outputHash,
    startedAt,
    durationMs: Date.now() - t0,
  };
}

export function truncate(s: string, max = 4000): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n... [truncated ${s.length - max} chars]`;
}
