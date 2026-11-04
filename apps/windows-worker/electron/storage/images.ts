import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  imageRefSchema,
  imageIdsSchema,
  imageLimits,
  imageScopeSchema,
  type ChatImage,
} from "../../shared/images";

// Inspect dimensions before passing input to the native decoder. SVG/GIF/WebP
// and all caller-supplied MIME/path values are deliberately unsupported.
export function inspectImage(data: Buffer) {
  if (!data.length || data.length > imageLimits.inputBytes)
    throw Error("Ảnh vượt giới hạn 5 MB.");
  let width = 0,
    height = 0,
    mime: ChatImage["mime"];
  if (
    data.length >= 33 &&
    data
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    data.toString("ascii", 12, 16) === "IHDR" &&
    data.readUInt32BE(8) === 13
  ) {
    mime = "image/png";
    width = data.readUInt32BE(16);
    height = data.readUInt32BE(20);
  } else if (data[0] === 0xff && data[1] === 0xd8) {
    mime = "image/jpeg";
    let offset = 2;
    while (offset + 4 <= data.length) {
      if (data[offset++] !== 0xff) break;
      while (data[offset] === 0xff) offset++;
      const marker = data[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      const length = data.readUInt16BE(offset);
      if (length < 2 || offset + length > data.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) {
        height = data.readUInt16BE(offset + 3);
        width = data.readUInt16BE(offset + 5);
        break;
      }
      offset += length;
    }
  } else throw Error("Chỉ nhận ảnh PNG hoặc JPEG.");
  if (
    !width ||
    !height ||
    width > imageLimits.edge ||
    height > imageLimits.edge ||
    width * height > imageLimits.pixels
  )
    throw Error("Ảnh không hợp lệ hoặc vượt 4096 px / 12 megapixel.");
  return { width, height, mime };
}

export class Images {
  constructor(
    private db: Database.Database,
    directory: string,
    version: number,
  ) {
    if (version >= 13) return;
    const backup = join(directory, "worker.schema12.pre-images.backup.sqlite");
    if (version === 12 && !existsSync(backup))
      db.prepare("VACUUM INTO ?").run(backup);
    db.transaction(() =>
      db.exec(`
      CREATE TABLE chat_images (id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL REFERENCES conversations(id), value TEXT NOT NULL,
        data BLOB NOT NULL, draft INTEGER NOT NULL DEFAULT 1);
      CREATE INDEX chat_images_scope ON chat_images(conversation_id,draft);
      PRAGMA user_version=13;
    `),
    )();
  }
  scope(projectId: string, conversationId: string) {
    imageScopeSchema.parse({ projectId, conversationId });
    const row = this.db
      .prepare("SELECT project_id FROM conversations WHERE id=?")
      .get(conversationId) as { project_id: string } | undefined;
    if (row?.project_id !== projectId)
      throw Error("Ảnh hoặc hội thoại thuộc dự án khác.");
  }
  refs(
    projectId: string,
    conversationId: string,
    ids: string[] = [],
  ): ChatImage[] {
    this.scope(projectId, conversationId);
    return imageIdsSchema.parse(ids).map((id) => {
      const row = this.db
        .prepare(
          "SELECT value FROM chat_images WHERE id=? AND project_id=? AND conversation_id=?",
        )
        .get(id, projectId, conversationId) as { value: string } | undefined;
      if (!row) throw Error("Ảnh không còn tồn tại hoặc thuộc hội thoại khác.");
      return JSON.parse(row.value) as ChatImage;
    });
  }
  drafts(projectId: string, conversationId: string): ChatImage[] {
    this.scope(projectId, conversationId);
    return (
      this.db
        .prepare(
          "SELECT value FROM chat_images WHERE project_id=? AND conversation_id=? AND draft=1 ORDER BY rowid",
        )
        .all(projectId, conversationId) as { value: string }[]
    ).map((row) => JSON.parse(row.value));
  }
  add(
    projectId: string,
    conversationId: string,
    name: string,
    data: Buffer,
  ): ChatImage[] {
    return this.db.transaction(() => {
      this.scope(projectId, conversationId);
      if (!this.db.prepare("SELECT id FROM projects WHERE id=?").get(projectId))
        throw Error("Dự án đã được gỡ.");
      if (this.drafts(projectId, conversationId).length >= imageLimits.count)
        throw Error("Mỗi tin nhắn tối đa 4 ảnh.");
      if (data.length > imageLimits.bytes)
        throw Error("Ảnh sau xử lý vượt 1 MB; hãy chọn ảnh nhỏ hơn.");
      const dimensions = inspectImage(data);
      const usage = this.db
        .prepare(
          "SELECT COALESCE(SUM(length(data)),0) AS total, COALESCE(SUM(CASE WHEN project_id=? THEN length(data) ELSE 0 END),0) AS project FROM chat_images",
        )
        .get(projectId) as { total: number; project: number };
      if (
        usage.total + data.length > imageLimits.totalBytes ||
        usage.project + data.length > imageLimits.projectBytes
      )
        throw Error("Kho ảnh đã đầy (100 MB/dự án, 500 MB tổng).");
      const image: ChatImage = {
        ...dimensions,
        id: randomUUID(),
        projectId,
        conversationId,
        name: name.replace(/[\\/\x00-\x1f\x7f]/g, "_").slice(0, 180) || "image",
        bytes: data.length,
        hash: createHash("sha256").update(data).digest("hex"),
        createdAt: new Date().toISOString(),
        source: "user",
      };
      this.db
        .prepare("INSERT INTO chat_images VALUES (?,?,?,?,?,1)")
        .run(image.id, projectId, conversationId, JSON.stringify(image), data);
      return this.drafts(projectId, conversationId);
    })();
  }
  read(projectId: string, conversationId: string, id: string) {
    const image = this.refs(projectId, conversationId, [id])[0];
    const { data } = this.db
      .prepare("SELECT data FROM chat_images WHERE id=?")
      .get(id) as { data: Buffer };
    if (
      data.length !== image.bytes ||
      createHash("sha256").update(data).digest("hex") !== image.hash
    )
      throw Error("Dữ liệu ảnh không còn toàn vẹn.");
    return { image, data };
  }
  sent(projectId: string, conversationId: string, ids: string[] = []) {
    for (const image of this.refs(projectId, conversationId, ids))
      this.db
        .prepare("UPDATE chat_images SET draft=0 WHERE id=?")
        .run(image.id);
  }
  detach(projectId: string, conversationId: string, id: string) {
    this.sent(projectId, conversationId, [id]);
    this.gc();
    return this.drafts(projectId, conversationId);
  }
  gc() {
    const used = new Set<string>();
    for (const table of ["runs", "follow_ups"]) {
      for (const row of this.db.prepare(`SELECT value FROM ${table}`).all() as {
        value: string;
      }[]) {
        for (const id of JSON.parse(row.value).imageIds ?? []) used.add(id);
      }
    }
    for (const row of this.db
      .prepare("SELECT id FROM chat_images WHERE draft=0")
      .all() as { id: string }[]) {
      if (!used.has(row.id))
        this.db.prepare("DELETE FROM chat_images WHERE id=?").run(row.id);
    }
  }
  parts(projectId: string, conversationId: string, ids: string[] = []) {
    return this.refs(projectId, conversationId, ids).map((image) => ({
      type: "file" as const,
      mime: image.mime,
      filename: image.name,
      url: `data:${image.mime};base64,${this.read(projectId, conversationId, image.id).data.toString("base64")}`,
    }));
  }
}

export function serveImage(store: Images, request: Request): Response {
  try {
    const url = new URL(request.url);
    if (
      request.method !== "GET" ||
      url.protocol !== "asf-image:" ||
      url.hostname !== "asset" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw Error("Invalid asset URL");
    const segments = url.pathname.split("/");
    if (segments.length !== 4 || segments[0]) throw Error("Invalid asset path");
    const ref = imageRefSchema.parse({
      projectId: segments[1],
      conversationId: segments[2],
      id: segments[3],
    });
    const { image, data } = store.read(
      ref.projectId,
      ref.conversationId,
      ref.id,
    );
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": image.mime,
        "Content-Length": String(data.length),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
