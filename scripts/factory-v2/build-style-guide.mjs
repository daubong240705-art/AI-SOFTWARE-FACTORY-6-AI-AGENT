import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = join(root, "design/factory-v2");
const read = (name) => readFileSync(join(source, name), "utf8");
const json = (name) => JSON.parse(read(name));
const tokens = json("tokens.json");
const kebab = (value) => value.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
const css = [];
for (const [group, prefix, suffix] of [
  ["fonts", "font", ""],
  ["spacing", "space", "px"],
  ["radii", "radius", "px"],
  ["sizes", "size", "px"],
  ["layers", "layer", ""],
  ["motion", "motion", "ms"],
])
  for (const [name, value] of Object.entries(tokens[group]))
    css.push(`  --${prefix}-${kebab(name)}: ${value}${suffix};`);
for (const [name, values] of Object.entries(tokens.typography))
  for (const [key, value] of Object.entries(values))
    css.push(
      `  --type-${name}-${kebab(key)}: ${value}${key === "weight" ? "" : "px"};`,
    );
const themes = Object.entries(tokens.themes)
  .map(
    ([theme, colors]) =>
      `${theme === tokens.defaultTheme ? ":root, " : ""}[data-theme="${theme}"] {\n${Object.entries(
        colors,
      )
        .map(([key, value]) => `  --color-${kebab(key)}: ${value};`)
        .join("\n")}\n}`,
  )
  .join("\n");
const tokenCss = `/* Generated from design/factory-v2/tokens.json. */\n:root {\n${css.join("\n")}\n}\n${themes}\n`;
const font = readFileSync(join(source, "assets/InterVariable.woff2")).toString(
  "base64",
);
const fontCss = `@font-face { font-family: 'Inter Variable'; font-style: normal; font-weight: 100 900; font-display: swap; src: url(data:font/woff2;base64,${font}) format('woff2'); }`;
const data = {
  tokens,
  seed: json("seed.json"),
  resources: { vi: json("labels.vi.json"), en: json("labels.en.json") },
  screens: json("screens.json"),
  components: json("components.json"),
};
const safeJson = JSON.stringify(data).replace(/</g, "\\u003c");
// Bundle only the exact local geometry module: no bundler, external imports or network.
const importLine = /^import\s*\{[^}]+\}\s*from "\.\/window-state\.mjs";\s*/;
const preview = read("preview.mjs");
if (!importLine.test(preview))
  throw Error("Unexpected preview import; review builder before bundling");
const bundle =
  read("window-state.mjs").replace(/^export /gm, "") +
  "\n" +
  preview.replace(importLine, "");
if (/<\/script/i.test(bundle))
  throw Error("Inline script closing tag must be escaped");
const html = `<!doctype html>\n<html lang="vi" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Factory V2</title><style>${fontCss}\n${tokenCss}\n${read("style-guide.css")}</style></head><body><div id="app"></div><dialog id="detail" class="detail-dialog"></dialog><script id="design-data" type="application/json">${safeJson}</script><script type="module">${bundle}</script></body></html>\n`;
const output = join(root, ".cache/factory-v2/style-guide");
mkdirSync(output, { recursive: true });
writeFileSync(join(output, "tokens.css"), tokenCss, "utf8");
writeFileSync(join(output, "index.html"), html, "utf8");
process.stdout.write(
  "Built .cache/factory-v2/style-guide/index.html (offline fixture; no Host/model/DB)\n",
);
