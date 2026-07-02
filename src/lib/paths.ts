import fs from "node:fs";
import path from "node:path";

/** Locate the repo root: nearest ancestor containing .git or .converge; falls back to cwd. */
export function findRepoRoot(start: string = process.cwd()): string {
  let dir = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(dir, ".converge")) || fs.existsSync(path.join(dir, ".git"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

export function convergeDir(root: string): string {
  return path.join(root, ".converge");
}

export function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

export function writeFileSafe(file: string, content: string): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, content, "utf8");
}

export function readFileIfExists(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** Convert an absolute path to a repo-relative POSIX-style path. */
export function toRepoRel(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/");
}
