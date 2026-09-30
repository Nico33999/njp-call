import { existsSync } from "node:fs";
import path from "node:path";

/** Vrai si `p` (ou un de ses parents) contient un `.git`. */
export const insideGitRepo = (p: string): boolean => {
  let dir = path.resolve(p);
  for (;;) {
    if (existsSync(path.join(dir, ".git"))) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
};
