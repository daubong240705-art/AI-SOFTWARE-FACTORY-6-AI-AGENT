import assert from "node:assert/strict";
import { test } from "node:test";
import { isAllowedMediaType, sniffMedia, previewable, extensionFor, mediaTypeFromFileName, mediaKind } from "../dist/artifacts/media.js";
import { samples } from "./documents-fixture.mjs";

for (const [type, extension, bytes, inline] of samples) {
  test(`media accepts ${type} with its signature and extension`, () => {
    assert.equal(isAllowedMediaType(type), true); assert.equal(sniffMedia(type, bytes), true);
    assert.equal(previewable(type), inline); assert.equal(extensionFor(type), extension);
    assert.equal(mediaTypeFromFileName(`file.${extension.toUpperCase()}`), type);
    assert.equal(mediaKind(type), type.startsWith("text/") || ["application/json", "image/svg+xml"].includes(type) ? "text" : "binary");
  });
  test(`media rejects invalid ${type}`, () => { assert.equal(sniffMedia(type, Buffer.from([0xff])), false); });
  test(`media rejects empty ${type}`, () => { assert.equal(sniffMedia(type, Buffer.alloc(0)), false); });
}
for (const type of ["text/plain", "text/markdown", "text/csv", "application/json", "image/svg+xml"]) test(`media rejects NUL in ${type}`, () => {
  assert.equal(sniffMedia(type, Buffer.from(type === "application/json" ? '{"a":"\x00"}' : "<svg>\x00text")), false);
});
test("media checks alternate GIF and JPEG extensions", () => {
  assert.equal(sniffMedia("image/gif", Buffer.from("GIF87a")), true); assert.equal(mediaTypeFromFileName("a.jpeg"), "image/jpeg");
  assert.equal(mediaTypeFromFileName("a.markdown"), "text/markdown");
});
for (const [type, , bytes] of samples.filter(([type]) => type.includes("openxmlformats"))) test(`media ZIP needs the expected part for ${type}`, () => {
  assert.equal(sniffMedia(type, Buffer.from("PK\x03\x04wrong/part.xml")), false);
  assert.equal(sniffMedia(type, bytes.subarray(4)), false);
  const padded = Buffer.concat([bytes.subarray(0, 4), Buffer.alloc(80000), bytes.subarray(4)]); assert.equal(sniffMedia(type, padded), true);
});
test("media rejects mismatched declaration, invalid JSON, SVG without a root, and malformed webp", () => {
  assert.equal(sniffMedia("image/png", samples[0][2]), false); assert.equal(sniffMedia("application/json", Buffer.from("{")), false);
  assert.equal(sniffMedia("image/svg+xml", Buffer.from("<html/>")), false); assert.equal(sniffMedia("image/webp", Buffer.from("RIFF0000WAVE")), false);
});
for (const type of ["text/html", "application/octet-stream", "application/zip", "application/msword", "application/x-executable", "IMAGE/PNG"]) test(`media denies ${type}`, () => {
  assert.equal(isAllowedMediaType(type), false); assert.equal(sniffMedia(type, samples[0][2]), false);
  assert.equal(previewable(type), false); assert.equal(extensionFor(type), null); assert.equal(mediaKind(type), null);
});
test("media does not infer unknown extensions or extensionless names", () => {
  for (const name of ["file", "file.", "file.html", "file.exe", "file.zip"]) assert.equal(mediaTypeFromFileName(name), null);
});
