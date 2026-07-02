import path from "node:path";
import type { AttractorConfig } from "../lib/config.js";
import { runCommand, truncate } from "../lib/exec.js";
import type { EvidenceRecord } from "../lib/report.js";
import { writeFileSafe } from "../lib/paths.js";

/**
 * E. Validation Execution Check.
 * Verification commands are executed by converge itself; exit code, output
 * hash and timestamps are recorded under .converge/reports/<PLAN>/evidence/.
 * Pre-existing log files are never accepted as closure evidence.
 */
export function runVerification(
  root: string,
  cfg: AttractorConfig,
  planId: string | null,
  opts: { skipExecution?: boolean } = {}
): EvidenceRecord[] {
  const commands = cfg.verification?.before_close ?? [];
  const evidenceDir = path.join(
    root,
    ".converge",
    "reports",
    planId ?? "adhoc",
    "evidence"
  );

  const records: EvidenceRecord[] = [];
  for (const cmd of commands) {
    if (opts.skipExecution) {
      records.push({
        id: cmd.id,
        command: cmd.command,
        required: cmd.required ?? false,
        executed: false,
        exitCode: null,
        outputHash: null,
        startedAt: null,
        durationMs: null,
      });
      continue;
    }
    const res = runCommand(cmd.command, root);
    const record: EvidenceRecord = {
      id: cmd.id,
      command: cmd.command,
      required: cmd.required ?? false,
      executed: true,
      exitCode: res.exitCode,
      outputHash: res.outputHash,
      startedAt: res.startedAt,
      durationMs: res.durationMs,
    };
    records.push(record);

    writeFileSafe(
      path.join(evidenceDir, `${cmd.id}.json`),
      JSON.stringify(
        {
          ...record,
          stdout: truncate(res.stdout, 20000),
          stderr: truncate(res.stderr, 20000),
        },
        null,
        2
      )
    );
    writeFileSafe(
      path.join(evidenceDir, `${cmd.id}.log`),
      `# executed by converge at ${res.startedAt}\n# command: ${cmd.command}\n# exit: ${res.exitCode}\n# sha256: ${res.outputHash}\n\n--- stdout ---\n${res.stdout}\n--- stderr ---\n${res.stderr}\n`
    );
  }
  return records;
}
