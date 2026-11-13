import fs from "node:fs";
import { join } from "node:path";
import { assertInside } from "./paths.js";

/** A task input the Host copies into the attempt worktree before the agent starts. */
export interface AttemptInputFile {
  title: string; mediaType: string; extension: string; bytes: Buffer; note: string | null;
}
export interface WrittenInput { path: string; title: string; mediaType: string; note: string | null }

export const INPUTS_DIR = ".factory/inputs";
export const MAX_INPUT_FILES = 20;
export const MAX_INPUT_BYTES = 50 * 1024 * 1024;

const slug = (text: string): string => text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "input";

/** Ensures `parent/name` is a real directory (never a link), creating it when absent. */
function realDirectory(parent: string, name: string): string {
  const path = assertInside(parent, join(parent, name));
  try {
    const stat = fs.lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Input directory invalid");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    fs.mkdirSync(path, { mode: 0o700 });
  }
  return path;
}

/**
 * Writes the inputs under `<worktree>/.factory/inputs/` (git-excluded scratch, never part of a result).
 * Files get sanitized names (`NN-<slug>.<ext>`), mode 0600 and exclusive creation; at most MAX_INPUT_FILES files and
 * MAX_INPUT_BYTES in total, later inputs beyond the limits are skipped and reported.
 */
export function writeAttemptInputs(worktree: string, files: readonly AttemptInputFile[]): { written: WrittenInput[]; skipped: number } {
  if (!files.length) return { written: [], skipped: 0 };
  const directory = realDirectory(realDirectory(worktree, ".factory"), "inputs");
  const written: WrittenInput[] = []; let total = 0; let skipped = 0;
  for (const file of files) {
    const extension = /^[a-z0-9]{1,8}$/.test(file.extension) ? file.extension : "bin";
    if (written.length >= MAX_INPUT_FILES || total + file.bytes.length > MAX_INPUT_BYTES) { skipped++; continue; }
    const name = `${String(written.length + 1).padStart(2, "0")}-${slug(file.title)}.${extension}`;
    const target = assertInside(directory, join(directory, name));
    fs.writeFileSync(target, file.bytes, { mode: 0o600, flag: "wx" });
    total += file.bytes.length;
    written.push({ path: `${INPUTS_DIR}/${name}`, title: file.title, mediaType: file.mediaType, note: file.note });
  }
  return { written, skipped };
}
