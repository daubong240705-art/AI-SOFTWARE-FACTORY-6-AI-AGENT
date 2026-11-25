import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function secretKey(stateDir: string, supplied = process.env.FACTORY_SECRET_KEY): Buffer {
  const invalid = () => new Error("Invalid integration secret key or key file permissions");
  if (supplied !== undefined) {
    const key = Buffer.from(supplied, "base64");
    if (key.length !== 32 || key.toString("base64").replace(/=$/, "") !== supplied.replace(/=$/, "")) throw invalid();
    return key;
  }
  const path = join(stateDir, "secret.key");
  const flags = constants.O_NOFOLLOW | constants.O_NONBLOCK;
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | flags); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw invalid();
    try {
      fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | flags, 0o600);
      const key = randomBytes(32);
      try { writeFileSync(fd, key); fsyncSync(fd); } finally { closeSync(fd); }
      return key;
    } catch (createError) {
      if ((createError as NodeJS.ErrnoException).code !== "EEXIST") throw invalid();
      return secretKey(stateDir, undefined);
    }
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o077) || stat.size !== 32) throw invalid();
    const key = readFileSync(fd);
    if (key.length !== 32) throw invalid();
    return key;
  } finally { closeSync(fd); }
}

export function credentialCrypto(key: Buffer) {
  const keyId = createHash("sha256").update(key).digest("hex");
  return {
    encrypt(id: string, value: string) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(Buffer.from(id));
      const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()]);
      return { nonce, ciphertext, keyId, last4: [...value].length > 4 ? [...value].slice(-4).join("") : "" };
    },
    decrypt(id: string, record: { nonce: Buffer; ciphertext: Buffer; key_id: string }): string {
      try {
        if (record.key_id !== keyId) throw new Error();
        const decipher = createDecipheriv("aes-256-gcm", key, record.nonce);
        decipher.setAAD(Buffer.from(id));
        decipher.setAuthTag(record.ciphertext.subarray(-16));
        return Buffer.concat([decipher.update(record.ciphertext.subarray(0, -16)), decipher.final()]).toString("utf8");
      } catch { throw new Error("Integration credential unavailable"); }
    },
  };
}
