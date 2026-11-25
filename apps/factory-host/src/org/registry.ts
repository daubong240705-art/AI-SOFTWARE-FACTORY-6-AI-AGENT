import { readdirSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { isRetiredGamePack, loadPack, type LoadedPack } from "./pack.js";

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
  const flows = (pack.files.flows ?? []).map(({ definition: { key, title } }) => ({ key, title, revision: 1 }));
  const workflows = [...flows, ...pack.files.workflows.filter(({ definition }) => !flows.some(({ key }) => key === definition.key))
    .map(({ definition: { key, revision, title } }) => ({ key, revision, title }))];
  const entry: RegistryPack = { key: manifest.key, version: manifest.version, name: manifest.name,
    description: manifest.description, seats: manifest.seats.map(({ name, role, runtime, slots, isLead, capabilities, tools }) =>
      ({ name, role, runtime, slots, isLead, ...(capabilities === undefined ? {} : { capabilities }),
        ...(tools === undefined ? {} : { tools }) })), isDefault,
    ...(manifest.produces === undefined ? {} : { produces: manifest.produces }),
    ...(workflows.length ? { workflows } : {}) };
  loaded.set(entry, pack);
  return entry;
}

export function registryPack(entry: RegistryPack): LoadedPack {
  const pack = loaded.get(entry);
  if (!pack) throw new Error("Pack unavailable");
  return pack;
}

export function loadPackRegistry(packsDir: string, options: {
  onError?: (message: string) => void; onExtensionPackError?: (message: string) => void;
  defaultPack?: LoadedPack; coreEntries?: RegistryPack[]; extraDirs?: readonly string[];
} = {}): RegistryPack[] {
  const report = (): void => { try { options.onError?.("Pack skipped: invalid pack"); } catch { /* Observer only. */ } };
  let directories: Dirent[] = [];
  if (!options.coreEntries) try { directories = readdirSync(packsDir, { withFileTypes: true }); }
  catch { report(); }
  const entries = [...(options.coreEntries ?? [])];
  for (const directory of directories.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!directory.isDirectory() || directory.name.startsWith("_") || directory.name.startsWith(".") || isRetiredGamePack(directory.name)) continue;
    let pack: LoadedPack;
    try { pack = loadPack(join(packsDir, directory.name)); }
    catch { report(); continue; }
    if (isRetiredGamePack(pack.manifest.key)) continue;
    if (entries.some((entry) => entry.key === pack.manifest.key)) throw new Error("Duplicate pack key");
    entries.push(registryEntry(pack, pack.manifest.key === (options.defaultPack?.manifest.key ?? "software-team")));
  }
  if (options.defaultPack) {
    const index = entries.findIndex((entry) => entry.key === options.defaultPack?.manifest.key);
    const entry = registryEntry(options.defaultPack, true);
    if (index < 0) entries.push(entry);
    else entries[index] = entry;
  }
  for (const [index, directory] of (options.extraDirs ?? []).entries()) {
    try {
      const pack = loadPack(directory);
      if (entries.some(({ key }) => key === pack.manifest.key)) throw new Error("Duplicate pack key");
      entries.push(registryEntry(pack));
    } catch { (options.onExtensionPackError ?? options.onError)?.(`Extension pack #${index + 1} skipped: invalid pack or duplicate key`); }
  }
  return entries.sort((a, b) => a.key.localeCompare(b.key));
}
