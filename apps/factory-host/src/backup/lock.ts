import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { join } from "node:path";

/** Coordinate Host lifetime and offline restore, including idle WAL connections that hold no write lock. */
export function lockStateDirectory(stateDir: string): () => void {
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const file = join(stateDir, ".host-running");
  const owner = JSON.stringify({ pid: process.pid, token: randomUUID() });
  for (let attempt = 0; attempt < 2; attempt++) {
    let fd: number;
    try { fd = fs.openSync(file, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new Error("State directory lock is unavailable");
      try {
        const existing = fs.readFileSync(file, "utf8");
        const pid: unknown = (JSON.parse(existing) as { pid?: unknown }).pid;
        if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid < 1) throw new Error("Invalid lock owner");
        try { process.kill(pid, 0); }
        catch (failure) {
          if ((failure as NodeJS.ErrnoException).code === "ESRCH" && fs.readFileSync(file, "utf8") === existing) {
            fs.unlinkSync(file);
            continue;
          }
          throw failure;
        }
      } catch { throw new Error("State directory is in use or its lock is unavailable; stop the Host before restoring"); }
      throw new Error("State directory is in use; stop the Host before restoring");
    }
    try { fs.writeFileSync(fd, owner); }
    catch {
      fs.closeSync(fd);
      try { fs.unlinkSync(file); } catch { /* Only the file exclusively created above is ours. */ }
      throw new Error("State directory lock is unavailable");
    }
    fs.closeSync(fd);
    return () => {
      try { if (fs.readFileSync(file, "utf8") === owner) fs.unlinkSync(file); }
      catch { /* Never replace or remove another owner's lock. */ }
    };
  }
  throw new Error("State directory lock is unavailable");
}
