import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";
import { labelSchema, runtimeKindSchema } from "@factory/contracts";
import { z } from "zod";

const relativePathSchema = z.string().min(1).refine((path) =>
  !isAbsolute(path) && !win32.isAbsolute(path) && !path.includes(":") && !path.includes("\0") &&
  !path.split(/[/\\]/).some((part) => part === ".." || part === "." || part === ""),
"Expected a relative path inside the pack without traversal");

export const packManifestSchema = z.strictObject({
  key: z.string().regex(/^[a-z0-9-]{2,40}$/),
  version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
  name: labelSchema.max(120),
  description: z.string().min(1).max(2_000),
  seats: z.array(z.strictObject({
    name: labelSchema, role: labelSchema,
    profile: relativePathSchema.refine((path) => path.endsWith(".md"), "Expected a .md profile"),
    runtime: runtimeKindSchema, slots: z.number().int().min(1).max(8), isLead: z.boolean(),
  })).min(1).max(16),
  skills: z.array(relativePathSchema),
}).superRefine((manifest, ctx) => {
  if (new Set(manifest.seats.map((seat) => seat.name)).size !== manifest.seats.length)
    ctx.addIssue({ code: "custom", path: ["seats"], message: "Duplicate seat name" });
  if (manifest.seats.filter((seat) => seat.isLead).length !== 1)
    ctx.addIssue({ code: "custom", path: ["seats"], message: "A pack must have exactly one lead seat" });
});

export type LoadedPack = { manifest: z.infer<typeof packManifestSchema>; digest: string; dir: string };

function inside(root: string, path: string): string {
  const resolved = resolve(root, path);
  const check = (candidate: string): void => {
    const rel = relative(root, candidate);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("Path escapes pack directory");
  };
  check(resolved);
  const real = realpathSync(resolved);
  check(real);
  return real;
}

export function loadPack(dir: string): LoadedPack {
  const root = realpathSync(resolve(dir));
  const manifestBytes = readFileSync(inside(root, "pack.json"));
  const manifest = packManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
  const hash = createHash("sha256");
  // Length-prefixed byte strings give an unambiguous concatenation, independent of OS or absolute directory.
  const add = (bytes: Buffer): void => { hash.update(`${bytes.length}:`); hash.update(bytes); };
  add(manifestBytes);
  for (const seat of manifest.seats) {
    const profile = inside(root, seat.profile);
    if (!statSync(profile).isFile()) throw new Error("Profile must be a file");
    add(readFileSync(profile));
  }
  for (const skill of manifest.skills) {
    const directory = inside(root, skill);
    if (!statSync(directory).isDirectory()) throw new Error("Skill must be a directory");
    if (!statSync(inside(root, `${skill}/SKILL.md`)).isFile()) throw new Error("Skill must contain SKILL.md");
  }
  return { manifest, digest: hash.digest("hex"), dir: root };
}
