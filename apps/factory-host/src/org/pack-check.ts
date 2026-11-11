import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { loadPack, packManifestSchema } from "./pack.js";
import { loadMcpServers } from "../mcp-external/config.js";
import { validateWorkflowDefinition } from "../workflow/validate.js";

export interface PackCheckResult {
  ok: boolean; errors: string[]; warnings: string[];
  summary: { key: string; version: string; seats: number; skills: number; digest: string; capabilities: number; tools: number };
}

const words = (text: string): number => text.trim() ? text.trim().split(/\s+/u).length : 0;
// Paths are labels only: never include arbitrary content, control characters or host paths in diagnostics.
const label = (path: string): string => /^[a-zA-Z0-9_./-]{1,160}$/.test(path) ? path : "[file]";

export function checkPackDirectory(dir: string, options: { serversFile?: string } = {}): PackCheckResult {
  const errors: string[] = []; const warnings: string[] = [];
  const summary: PackCheckResult["summary"] = { key: "", version: "", seats: 0, skills: 0, digest: "", capabilities: 0, tools: 0 };
  const done = (): PackCheckResult => ({ ok: errors.length === 0, errors, warnings, summary });
  let serverNames: Set<string> | undefined;
  if (options.serversFile !== undefined) {
    try { serverNames = new Set(loadMcpServers(options.serversFile).servers.map((server) => server.name)); }
    catch { errors.push("Invalid external MCP configuration"); return done(); }
  }
  let root: string;
  try { root = realpathSync(resolve(dir)); }
  catch { errors.push("pack directory: unavailable"); return done(); }
  const read = (path: string): string => {
    const file = realpathSync(resolve(root, path));
    const rel = relative(root, file);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error();
    if (!statSync(file).isFile() || statSync(file).size > 65536) throw new Error();
    const bytes = readFileSync(file);
    if (bytes.length > 65536 || bytes.includes(0)) throw new Error();
    return bytes.toString("utf8");
  };
  let input: unknown;
  try { input = JSON.parse(read("pack.json")) as unknown; }
  catch { errors.push("pack.json: missing or invalid JSON"); return done(); }
  const parsed = packManifestSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.map((part) => typeof part === "number" ? String(part)
        : ["key", "version", "name", "description", "seats", "skills", "workflows", "produces", "role", "profile", "runtime", "slots", "isLead", "capabilities", "tools"].includes(String(part)) ? String(part) : "field").join(".") || "manifest";
      const message = issue.message === "unknown tool" ? "unknown tool"
        : issue.message.startsWith("duplicate") || issue.message.startsWith("Duplicate") ? "duplicate value" : "invalid value";
      errors.push(`${path}: ${message}`);
    }
    return done();
  }
  const manifest = parsed.data;
  if (serverNames !== undefined) for (const tool of new Set(manifest.seats.flatMap((seat) => seat.tools ?? []))) {
    if (tool.startsWith("ext.") && !serverNames.has(tool.split(".")[1] ?? ""))
      warnings.push(`tools: ${tool} references a server that is not configured`);
  }
  Object.assign(summary, { key: manifest.key, version: manifest.version, seats: manifest.seats.length,
    skills: manifest.skills.length, capabilities: new Set(manifest.seats.flatMap((seat) => seat.capabilities ?? [])).size,
    tools: new Set(manifest.seats.flatMap((seat) => seat.tools ?? [])).size });
  const v2 = manifest.seats.some((seat) => seat.capabilities !== undefined || seat.tools !== undefined) || manifest.produces !== undefined;
  if (manifest.produces === undefined) warnings.push("produces: missing");
  const hasCapabilities = manifest.seats.some((seat) => seat.capabilities !== undefined);
  for (const [index, seat] of manifest.seats.entries()) {
    if (hasCapabilities && !seat.capabilities?.length) warnings.push(`seats.${index}.capabilities: missing`);
    if (new Set(seat.tools).size !== (seat.tools?.length ?? 0)) warnings.push(`seats.${index}.tools: duplicate tool`);
    if (v2 && seat.isLead) for (const capability of seat.capabilities ?? []) {
      if (!manifest.seats.some((other) => !other.isLead && other.capabilities?.some((value) =>
        value === capability || value.startsWith(`${capability}.`)))) warnings.push(`seats.${index}.capabilities: lead capability has no worker`);
    }
    try { if (words(read(seat.profile)) > 450) warnings.push(`profile ${label(seat.profile)}: above 450 words`); }
    catch { errors.push(`profile ${label(seat.profile)}: missing or invalid`); }
  }
  for (const skill of manifest.skills) {
    try {
      const content = read(`${skill}/SKILL.md`);
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1];
      let description = frontmatter?.match(/^description:[ \t]*(.*)$/m)?.[1]?.trim() ?? "";
      if ((description.startsWith('"') && description.endsWith('"')) || (description.startsWith("'") && description.endsWith("'"))) description = description.slice(1, -1).trim();
      // Legacy packs may lack descriptions; preserve validity without rewriting pinned bytes.
      if (!description) (v2 ? errors : warnings)
        .push(`skill ${label(skill)}: SKILL.md has no description`);
      if (Array.from(description).length > 250) warnings.push(`skill ${label(skill)}: description above 250 chars`);
      if (words(content) > 700) warnings.push(`skill ${label(skill)}: above 700 words`);
    } catch { errors.push(`skill ${label(skill)}: SKILL.md missing or invalid`); }
  }
  try {
    const pack = loadPack(root); summary.digest = pack.digest;
    for (const [index, file] of pack.files.workflows.entries()) {
      const result = validateWorkflowDefinition(file.definition, v2
        ? { knownCapabilities: new Set(manifest.seats.flatMap((seat) => seat.capabilities ?? [])) } : {});
      errors.push(...result.errors.map((message) => `workflows.${index}.${message}`));
      warnings.push(...result.warnings.map((message) => `workflows.${index}.${message}`));
    }
  }
  catch { if (!errors.length) errors.push("pack: invalid content"); }
  return done();
}
