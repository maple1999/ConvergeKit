import { execFileSync } from "node:child_process";

export interface DiffFile {
  path: string;
  status: "A" | "M" | "D" | "R" | "C" | "T" | "U" | "X";
  oldPath?: string;
  addedLines: number;
  deletedLines: number;
}

export interface DiffSummary {
  base: string;
  files: DiffFile[];
  totalAdded: number;
  totalDeleted: number;
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
}

export function isGitRepo(root: string): boolean {
  try {
    git(root, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

export function currentCommit(root: string): string {
  try {
    return git(root, ["rev-parse", "HEAD"]).trim();
  } catch {
    return "(no commits)";
  }
}

export function currentBranch(root: string): string {
  try {
    return git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  } catch {
    return "(unknown)";
  }
}

/**
 * Diff of the working tree (staged + unstaged) against a base ref (default HEAD).
 * This captures "what the AI agent changed" in the common local workflow.
 */
export function getDiffSummary(root: string, base = "HEAD"): DiffSummary {
  const nameStatus = git(root, ["diff", "--name-status", "-M", base]);
  const numstat = git(root, ["diff", "--numstat", "-M", base]);

  const counts = new Map<string, { added: number; deleted: number }>();
  for (const line of numstat.split("\n")) {
    if (!line.trim()) continue;
    const [a, d, ...rest] = line.split("\t");
    const p = rest.join("\t");
    // renames appear as "old => new" style path{old => new}; use final segment
    const finalPath = p.includes("=>") ? parseRenamePath(p) : p;
    counts.set(finalPath, {
      added: a === "-" ? 0 : parseInt(a, 10),
      deleted: d === "-" ? 0 : parseInt(d, 10),
    });
  }

  const files: DiffFile[] = [];
  for (const line of nameStatus.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const statusCode = parts[0][0] as DiffFile["status"];
    let filePath: string;
    let oldPath: string | undefined;
    if (statusCode === "R" || statusCode === "C") {
      oldPath = parts[1];
      filePath = parts[2];
    } else {
      filePath = parts[1];
    }
    const c = counts.get(filePath) ?? { added: 0, deleted: 0 };
    files.push({
      path: filePath,
      status: statusCode,
      oldPath,
      addedLines: c.added,
      deletedLines: c.deleted,
    });
  }

  return {
    base,
    files,
    totalAdded: files.reduce((s, f) => s + f.addedLines, 0),
    totalDeleted: files.reduce((s, f) => s + f.deletedLines, 0),
  };
}

function parseRenamePath(p: string): string {
  // formats: "src/{old => new}/x.ts" or "old.ts => new.ts"
  const braced = p.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (braced) return `${braced[1]}${braced[3]}${braced[4]}`.replace(/\/\//g, "/");
  const arrow = p.match(/^(.*) => (.*)$/);
  if (arrow) return arrow[2];
  return p;
}

/** Full unified diff text against base. */
export function getDiffText(root: string, base = "HEAD"): string {
  return git(root, ["diff", "-M", base]);
}

/** Unified diff text for specific paths. */
export function getDiffTextFor(root: string, base: string, paths: string[]): string {
  if (paths.length === 0) return "";
  return git(root, ["diff", "-M", base, "--", ...paths]);
}

/** Content of a file at a ref, or null if it did not exist there. */
export function getFileAt(root: string, ref: string, filePath: string): string | null {
  try {
    return git(root, ["show", `${ref}:${filePath}`]);
  } catch {
    return null;
  }
}
