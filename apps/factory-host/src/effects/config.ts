export interface PushRemote { name: string; url: string }

const invalid = (): never => { throw new Error("FACTORY_PUSH_REMOTES must contain unique valid named remotes"); };

export function parsePushRemotes(text: string): PushRemote[] {
  if (typeof text !== "string" || !text) return invalid();
  const names = new Set<string>();
  const urls = new Set<string>();
  return text.split(",").map((entry) => {
    const separator = entry.indexOf("=");
    const name = entry.slice(0, separator);
    const value = entry.slice(separator + 1);
    if (separator < 1 || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(name) || names.has(name)
      || !value || value.length > 300 || /[\s\p{Cc}\p{Cf}\\?#]/u.test(value)) return invalid();
    let url: URL;
    try { url = new URL(value); } catch { return invalid(); }
    if (!["https:", "ssh:", "file:"].includes(url.protocol) || !value.startsWith(`${url.protocol}//`)
      || url.password || url.search || url.hash) return invalid();
    const authority = value.slice(value.indexOf("://") + 3).split("/", 1)[0] ?? "";
    // Refuse even empty passwords and encoded password separators, before URL normalization.
    if (authority.includes("@")) {
      const user = authority.slice(0, authority.lastIndexOf("@"));
      let decoded: string;
      try { decoded = decodeURIComponent(user); } catch { return invalid(); }
      if (!user || decoded.includes(":")) return invalid();
    }
    if (url.protocol === "file:") {
      if (authority || url.host || !value.startsWith("file:///") || !url.pathname.startsWith("/")
        || url.username || url.pathname === "/" || /^\/[a-z]:[^/]/i.test(url.pathname)) return invalid();
    } else if (!url.hostname || url.hostname.startsWith("-")) return invalid();
    // Canonical comparison catches alternate spellings of the same destination.
    if (urls.has(url.href)) return invalid();
    names.add(name); urls.add(url.href);
    return { name, url: value };
  });
}

export function describeRemote(remote: PushRemote): string { return remote.name; }

export function validatePushSshCommand(command: string | undefined): void {
  if (command !== undefined && (typeof command !== "string" || /[\r\n\0]/.test(command)))
    throw new Error("FACTORY_PUSH_SSH_COMMAND must not contain line breaks or NUL");
}
