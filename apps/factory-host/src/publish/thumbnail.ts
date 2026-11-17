export interface ReleaseThumbnail { bytes: Buffer; type: string }

const types: Readonly<Record<string, string>> = {
  svg: "image/svg+xml", png: "image/png", webp: "image/webp",
};

function thumbnailPath(value: unknown): { path: string; type: string } {
  // Reject escapes too: a Portal must not decode an encoded traversal or separator.
  if (typeof value !== "string" || !value || value.startsWith("/") || value.includes("..")
    || /[\\:%?#\s\p{Cc}]/u.test(value) || value.split("/").some(part => part === "" || part === ".")) throw new Error();
  const extension = /\.(svg|png|webp)$/i.exec(value)?.[1]?.toLowerCase();
  const type = extension === undefined ? undefined : types[extension];
  if (!type) throw new Error();
  return { path: value.split("/").map(encodeURIComponent).join("/"), type };
}

/** Public Portal assets never use the authenticated publishing request helper. */
export function createThumbnailLoader(url: string, fetchImpl: typeof fetch, requests: Set<AbortController>) {
  const cache = new Map<string, ReleaseThumbnail>();
  const read = async (path: string, limit: number, expectedType?: string): Promise<Buffer> => {
    const controller = new AbortController();
    requests.add(controller);
    // A hard deadline for the whole read: aborting the signal alone does not always settle a body
    // read that stalls after the headers arrived, so the race guarantees the 5 s limit.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("timeout")); }, 5_000); });
    try {
      return await Promise.race([readBody(), deadline]);
    } finally {
      controller.abort();
      clearTimeout(timer);
      requests.delete(controller);
    }
    async function readBody(): Promise<Buffer> {
      const response = await fetchImpl(`${url}${path}`, { method: "GET", redirect: "error", signal: controller.signal });
      if (response.status !== 200 || !response.body) throw new Error();
      if (expectedType !== undefined && response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== expectedType)
        throw new Error();
      const reader = response.body.getReader(), chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const item = await reader.read();
          if (item.done) break;
          size += item.value.byteLength;
          if (size > limit) throw new Error();
          chunks.push(item.value);
        }
        return Buffer.concat(chunks, size);
      } finally {
        controller.abort();
        void reader.cancel().catch(() => undefined);
      }
    }
  };
  return async (gameId: string, version: number): Promise<ReleaseThumbnail> => {
    const key = `${gameId}:${version}`, cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      cache.set(key, cached);
      return cached;
    }
    const base = `/g/${gameId}/v${version}/`;
    const manifest: unknown = JSON.parse((await read(`${base}game.json`, 64 * 1024)).toString("utf8"));
    if (typeof manifest !== "object" || manifest === null || !("thumbnail" in manifest)) throw new Error();
    const { path, type } = thumbnailPath(manifest.thumbnail);
    const thumbnail = { bytes: await read(`${base}${path}`, 512 * 1024, type), type };
    cache.delete(key);
    cache.set(key, thumbnail);
    if (cache.size > 50) cache.delete(cache.keys().next().value!);
    return thumbnail;
  };
}
