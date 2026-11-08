import type { Database } from "better-sqlite3";
import { packManifestSchema, type LoadedPack } from "../org/pack.js";
import { registryPack, type RegistryPack } from "../org/registry.js";

export interface SeatInstructions {
  packDigest: string; profilePath: string; profile: string;
  skills: { name: string; description: string }[];
}

export function capturePackSnapshot(raw: Database, pack: LoadedPack, now: Date | string): string {
  return raw.transaction(() => {
    raw.prepare(`INSERT OR IGNORE INTO pack_snapshots (digest, pack_key, pack_version, manifest_json, captured_at)
      VALUES (?, ?, ?, ?, ?)`).run(pack.digest, pack.manifest.key, pack.manifest.version,
      JSON.stringify(pack.manifest), typeof now === "string" ? now : now.toISOString());
    const insert = raw.prepare(`INSERT OR IGNORE INTO pack_files (digest, path, kind, name, description, content)
      VALUES (?, ?, ?, ?, ?, ?)`);
    for (const profile of pack.files.profiles) insert.run(pack.digest, profile.path, "profile", null, null, profile.content);
    for (const skill of pack.files.skills) insert.run(pack.digest, skill.path, "skill", skill.name, skill.description, skill.content);
    return pack.digest;
  })();
}

function pinnedSeat(raw: Database, input: { seatId: string }) {
  const row = raw.prepare(`SELECT t.pack_digest AS digest, s.name, p.manifest_json AS manifest
    FROM seats s JOIN teams t ON t.id = s.team_id JOIN pack_snapshots p ON p.digest = t.pack_digest
    WHERE s.id = ?`).get(input.seatId) as { digest: string; name: string; manifest: string } | undefined;
  if (!row) return null;
  const manifest = packManifestSchema.parse(JSON.parse(row.manifest) as unknown);
  const seat = manifest.seats.find((entry) => entry.name === row.name);
  if (!seat) return null;
  return { digest: row.digest, seat };
}

export function getSeatCapabilities(raw: Database, input: { seatId: string }): string[] | null {
  const pinned = pinnedSeat(raw, input);
  return pinned === null ? null : pinned.seat.capabilities ?? null;
}

export function getSeatTools(raw: Database, input: { seatId: string }): string[] | null {
  return pinnedSeat(raw, input)?.seat.tools ?? null;
}

export function getSeatInstructions(raw: Database, input: { seatId: string }): SeatInstructions | null {
  const row = pinnedSeat(raw, input);
  if (!row) return null;
  const { seat } = row;
  const profile = raw.prepare("SELECT content FROM pack_files WHERE digest = ? AND path = ? AND kind = 'profile'")
    .get(row.digest, seat.profile) as { content: string } | undefined;
  if (!profile) return null;
  const skills = raw.prepare(`SELECT name, description FROM pack_files WHERE digest = ? AND kind = 'skill' ORDER BY path`)
    .all(row.digest) as { name: string; description: string }[];
  return { packDigest: row.digest, profilePath: seat.profile, profile: profile.content, skills };
}

export function getSkill(raw: Database, input: { seatId: string; name: string }): string | null {
  const row = raw.prepare(`SELECT f.content FROM seats s JOIN teams t ON t.id = s.team_id
    JOIN pack_files f ON f.digest = t.pack_digest AND f.kind = 'skill' WHERE s.id = ? AND f.name = ?`)
    .get(input.seatId, input.name) as { content: string } | undefined;
  return row?.content ?? null;
}

/** Startup recovery is best effort and only captures the exact registered pack version. */
export function backfillPackSnapshots(raw: Database, packs: readonly RegistryPack[], now: Date | string): void {
  let failed = false;
  try {
    const teams = raw.prepare(`SELECT id, pack_key, pack_version FROM teams
      WHERE pack_digest IS NULL AND pack_key IS NOT NULL AND pack_version IS NOT NULL`)
      .all() as { id: string; pack_key: string; pack_version: string }[];
    for (const team of teams) {
      const entry = packs.find((pack) => pack.key === team.pack_key && pack.version === team.pack_version);
      if (!entry) continue;
      try {
        raw.transaction(() => {
          const digest = capturePackSnapshot(raw, registryPack(entry), now);
          raw.prepare("UPDATE teams SET pack_digest = ? WHERE id = ? AND pack_digest IS NULL").run(digest, team.id);
        })();
      } catch { failed = true; }
    }
  } catch { failed = true; }
  if (failed) console.error("Instructions unavailable");
}
