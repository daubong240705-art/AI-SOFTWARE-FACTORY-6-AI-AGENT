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

export type LoadedPack = {
  manifest: z.infer<typeof packManifestSchema>; digest: string; dir: string;
  files: { profiles: { path: string; content: string }[];
    skills: { name: string; path: string; description: string; content: string }[] };
};

function descriptionFor(content: string): string {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1];
  let description = frontmatter?.match(/^description:[ \t]*(.*)$/m)?.[1]?.trim() ?? "";
  if ((description.startsWith('"') && description.endsWith('"'))
    || (description.startsWith("'") && description.endsWith("'"))) description = description.slice(1, -1);
  return Array.from(description).slice(0, 250).join("");
}

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
  const files: LoadedPack["files"] = { profiles: [], skills: [] };
  // Length-prefixed byte strings give an unambiguous concatenation, independent of OS or absolute directory.
  const add = (bytes: Buffer): void => { hash.update(`${bytes.length}:`); hash.update(bytes); };
  add(manifestBytes);
  const readContent = (path: string): { bytes: Buffer; content: string } => {
    const file = inside(root, path);
    if (!statSync(file).isFile() || statSync(file).size > 65536) throw new Error("Invalid pack content");
    const bytes = readFileSync(file);
    if (bytes.length > 65536 || bytes.includes(0)) throw new Error("Invalid pack content");
    return { bytes, content: bytes.toString("utf8") };
  };
  for (const seat of manifest.seats) {
    const { bytes, content } = readContent(seat.profile);
    add(bytes);
    files.profiles.push({ path: seat.profile, content });
  }
  for (const skill of manifest.skills) {
    const directory = inside(root, skill);
    if (!statSync(directory).isDirectory()) throw new Error("Skill must be a directory");
    const name = skill.split(/[/\\]/).at(-1)!;
    const path = `${skill.replaceAll("\\", "/")}/SKILL.md`;
    const { bytes, content } = readContent(path);
    add(bytes);
    files.skills.push({ name, path, description: descriptionFor(content), content });
  }
  return { manifest, digest: hash.digest("hex"), dir: root, files };
}
