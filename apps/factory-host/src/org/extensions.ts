import { readFileSync, realpathSync, statSync } from "node:fs";
import { z } from "zod";
import { inside, relativePathSchema } from "./pack.js";

const keySchema = z.string().regex(/^[a-z0-9-]{2,40}$/);
const extensionSchema = z.strictObject({
  key: keySchema, name: z.string().min(1).max(120), description: z.string().min(1).max(2000),
  version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
  packs: z.array(relativePathSchema).max(64),
});

export function extensionPackDirs(root: string, keys: readonly string[], report: (message: string) => void): string[] {
  const directories = new Set<string>();
  for (const key of new Set(keys)) {
    if (!keySchema.safeParse(key).success) { report("Extension skipped: invalid key"); continue; }
    try {
      const dir = inside(realpathSync(root), key);
      const path = inside(dir, "extension.json");
      const stat = statSync(path);
      if (!stat.isFile() || stat.size > 65536) throw new Error();
      const manifest = extensionSchema.parse(JSON.parse(readFileSync(path, "utf8")) as unknown);
      if (manifest.key !== key) throw new Error();
      for (const [index, pack] of manifest.packs.entries()) {
        try { directories.add(inside(dir, pack)); }
        catch { report(`Extension '${key}': pack #${index + 1} skipped (missing or unsafe)`); }
      }
    } catch { report(`Extension '${key}' skipped: missing or invalid manifest`); }
  }
  return [...directories];
}
