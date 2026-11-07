// Secret hygiene. Used on prompts BEFORE they are sent and on logs BEFORE they are written.
// The key value itself is never stored, printed or passed on a command line.

const PATTERNS = [
  { kind: "sk-token", re: /\bsk-[A-Za-z0-9_-]{16,}/g },
  { kind: "bearer", re: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi },
  { kind: "assignment", re: /\b(api[_-]?key|token|secret|password|authorization)\b\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{12,}/gi },
  { kind: "private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
];

function envSecrets(env) {
  const out = [];
  for (const name of ["NINE_ROUTER_API_KEY", "OPENPROJECT_API_TOKEN", "OPENAI_API_KEY"]) {
    const v = env[name];
    if (typeof v === "string" && v.length >= 8) out.push({ name, value: v });
  }
  return out;
}

export function findSecrets(text, env = process.env) {
  const kinds = new Set();
  for (const { kind, re } of PATTERNS) {
    re.lastIndex = 0;
    if (re.test(text)) kinds.add(kind);
  }
  for (const { name, value } of envSecrets(env)) if (text.includes(value)) kinds.add(`env:${name}`);
  return [...kinds];
}

export function redact(text, env = process.env) {
  let out = text;
  for (const { name, value } of envSecrets(env)) out = out.split(value).join(`[REDACTED:${name}]`);
  for (const { re } of PATTERNS) out = out.replace(re, "[REDACTED]");
  return out;
}
