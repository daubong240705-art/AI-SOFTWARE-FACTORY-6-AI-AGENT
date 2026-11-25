import { readdirSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { loadPack, type LoadedPack } from "./pack.js";

export interface RegistryPack {
  key: string; version: string; name: string; description: string;
  seats: { name: string; role: string; runtime: LoadedPack["manifest"]["seats"][number]["runtime"]; slots: number; isLead: boolean;
    capabilities?: string[]; tools?: string[] }[];
  produces?: LoadedPack["manifest"]["produces"];
  workflows?: { key: string; revision: number; title: string }[];
  isDefault: boolean;
}
const loaded = new WeakMap<RegistryPack, LoadedPack>();

/** Public registry entries contain metadata only. Profiles and directories stay private. */
export function registryEntry(pack: LoadedPack, isDefault = false): RegistryPack {
  const { manifest } = pack;
  const entry: RegistryPack = { key: manifest.key, version: manifest.version, name: manifest.name,
    description: manifest.description, seats: manifest.seats.map(({ name, role, runtime, slots, isLead, capabilities, tools }) =>
      ({ name, role, runtime, slots, isLead, ...(capabilities === undefined ? {} : { capabilities }),
        ...(tools === undefined ? {} : { tools }) })), isDefault,
    ...(manifest.produces === undefined ? {} : { produces: manifest.produces }),
    ...(pack.files.workflows.length ? { workflows: pack.files.workflows.map(({ definition: { key, revision, title } }) => ({ key, revision, title })) } : {}) };
  loaded.set(entry, pack);
  return entry;
}

export function registryPack(entry: RegistryPack): LoadedPack {
  const pack = loaded.get(entry);
  if (!pack) throw new Error("Pack unavailable");
  return pack;
}

export function loadPackRegistry(packsDir: string, options: {
  onError?: (message: string) => void; defaultPack?: LoadedPack;
} = {}): RegistryPack[] {
  const report = (): void => { try { options.onError?.("Pack skipped: invalid pack"); } catch { /* Observer only. */ } };
  let directories: Dirent[];
  try { directories = readdirSync(packsDir, { withFileTypes: true }); }
  catch { report(); return options.defaultPack ? [registryEntry(options.defaultPack, true)] : []; }
  const entries: RegistryPack[] = [];
  for (const directory of directories.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!directory.isDirectory() || directory.name.startsWith("_") || directory.name.startsWith(".")) continue;
    let pack: LoadedPack;
    try { pack = loadPack(join(packsDir, directory.name)); }
    catch { report(); continue; }
    if (entries.some((entry) => entry.key === pack.manifest.key)) throw new Error("Duplicate pack key");
    entries.push(registryEntry(pack, pack.manifest.key === (options.defaultPack?.manifest.key ?? "software-team")));
  }
  if (options.defaultPack) {
    const index = entries.findIndex((entry) => entry.key === options.defaultPack?.manifest.key);
    const entry = registryEntry(options.defaultPack, true);
    if (index < 0) entries.push(entry);
    else entries[index] = entry;
  }
  return entries.sort((a, b) => a.key.localeCompare(b.key));
}
