import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { assertInside, refuseMount } from "../workspace/paths.js";

export interface ContentStore {
  put(bytes: Uint8Array | string): { hash: string; size: number };
  get(hash: string): Buffer | null;
  has(hash: string): boolean;
  size(hash: string): number | null;
}

const unavailable = (): Error => new Error("Content unavailable");
const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === "ENOENT";
function validateHash(hash: string): void {
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$(?![\s\S])/.test(hash)) throw unavailable();
}

/** Synchronous, private, verified objects. Errors deliberately carry no filesystem details. */
export function createContentStore(options: { dir: string; maxObjectBytes?: number }): ContentStore {
  const limit = options.maxObjectBytes ?? 8 * 1024 * 1024;
  let root: string;
  const plain = (path: string, directory: boolean): void => {
    const stat = fs.lstatSync(path);
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) throw unavailable();
  };
  try {
    if (!Number.isSafeInteger(limit) || limit < 0) throw unavailable();
    refuseMount(options.dir);
    try { plain(options.dir, true); } catch (error) { if (!missing(error)) throw error; }
    root = assertInside(dirname(options.dir), options.dir);
    refuseMount(root);
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    plain(root, true);
    fs.chmodSync(root, 0o700);
  } catch { throw unavailable(); }
  const checkedRoot = (): void => {
    plain(root, true);
    if (assertInside(dirname(root), root) !== root) throw unavailable();
  };
  const objectPath = (hash: string, create = false): string => {
    checkedRoot();
    const directory = join(root, hash.slice(0, 2));
    // lstat precedes canonicalization: even links pointing inside the store are refused.
    try { plain(directory, true); }
    catch (error) {
      if (!missing(error) || !create) throw error;
      try { fs.mkdirSync(assertInside(root, directory), { mode: 0o700 }); }
      catch (creationError) { if ((creationError as NodeJS.ErrnoException).code !== "EEXIST") throw creationError; }
    }
    plain(directory, true);
    assertInside(root, directory);
    const file = join(directory, hash);
    try { plain(file, false); } catch (error) { if (!missing(error)) throw error; }
    return assertInside(root, file);
  };
  const read = (file: string, hash: string): Buffer | null => {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > limit) return null;
      const bytes = fs.readFileSync(fd);
      return digest(bytes) === hash ? bytes : null;
    } finally { fs.closeSync(fd); }
  };
  const get = (hash: string): Buffer | null => {
    validateHash(hash);
    try { return read(objectPath(hash), hash); }
    catch (error) { if (missing(error)) return null; throw unavailable(); }
  };
  return {
    put(input) {
      let temporary: string | undefined;
      let lock: string | undefined;
      let locked = false;
      try {
        const bytes = Buffer.from(input);
        if (bytes.length > limit) throw unavailable();
        const hash = digest(bytes);
        const file = objectPath(hash, true);
        lock = assertInside(root, join(dirname(file), `${hash}.lock`));
        // Serializes publishers across processes; rename must never replace an existing object.
        const deadline = Date.now() + 5000;
        for (;;) {
          try {
            const fd = fs.openSync(lock, "wx", 0o600);
            locked = true; fs.closeSync(fd); break;
          } catch (error) {
            // Windows reports a lock that is being deleted as EPERM/EACCES instead of EEXIST: wait and retry.
            const code = (error as NodeJS.ErrnoException).code;
            if (!["EEXIST", "EPERM", "EACCES"].includes(code ?? "") || Date.now() >= deadline) throw unavailable();
            let held: fs.Stats | undefined;
            // The holder may release the lock between our failed open and this lstat: that is not an error.
            try { held = fs.lstatSync(lock); } catch (statError) { if (!missing(statError)) throw statError; }
            if (held === undefined) continue;
            if (held.isSymbolicLink() || !held.isFile()) throw unavailable();
            // A lock left by a crashed Host would otherwise block this content forever.
            if (Date.now() - held.mtimeMs > 30_000) {
              try { fs.unlinkSync(assertInside(root, lock)); } catch { /* Another publisher may have removed it. */ }
              continue;
            }
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
          }
        }
        try {
          const existing = read(objectPath(hash), hash);
          if (existing === null) throw unavailable();
          return { hash, size: existing.length };
        } catch (error) { if (!missing(error)) throw error; }
        temporary = assertInside(root, join(dirname(file), `${hash}.${randomUUID()}.tmp`));
        fs.writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
        plain(temporary, false);
        objectPath(hash);
        fs.renameSync(assertInside(root, temporary), assertInside(root, file));
        temporary = undefined;
        return { hash, size: bytes.length };
      } catch { throw unavailable(); }
      finally {
        for (const path of [temporary, locked ? lock : undefined]) {
          if (path !== undefined) {
            try { checkedRoot(); fs.unlinkSync(assertInside(root, path)); } catch { /* No raw filesystem errors escape. */ }
          }
        }
      }
    },
    get,
    has: (hash) => get(hash) !== null,
    size: (hash) => get(hash)?.length ?? null,
  };
}
