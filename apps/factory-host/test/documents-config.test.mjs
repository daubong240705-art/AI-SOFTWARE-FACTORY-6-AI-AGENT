import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEnv } from "../dist/host.js";

test("document configuration defaults to 25 MiB and 2 GiB", () => {
  assert.deepEqual(parseEnv({}).documents, { maxBytes: 26214400, quotaBytes: 2147483648 });
});
for (const value of ["1048576", "104857600", "26214400"]) test(`document maximum accepts ${value}`, () => {
  assert.equal(parseEnv({ FACTORY_DOC_MAX_BYTES: value }).documents.maxBytes, Number(value));
});
for (const value of ["1", "2147483648", String(Number.MAX_SAFE_INTEGER)]) test(`document quota accepts ${value}`, () => {
  assert.equal(parseEnv({ FACTORY_DOC_QUOTA_BYTES: value }).documents.quotaBytes, Number(value));
});
for (const value of ["", "0", "-1", "1048575", "104857601", "1.5", "25MB", "1e8", " 1048576", "9007199254740992"]) test(`document maximum rejects ${JSON.stringify(value)}`, () => {
  assert.throws(() => parseEnv({ FACTORY_DOC_MAX_BYTES: value }), /FACTORY_DOC_MAX_BYTES/);
});
for (const value of ["", "0", "-1", "1.5", "2GB", "1e9", " 1024", "9007199254740992"]) test(`document quota rejects ${JSON.stringify(value)}`, () => {
  assert.throws(() => parseEnv({ FACTORY_DOC_QUOTA_BYTES: value }), /FACTORY_DOC_QUOTA_BYTES/);
});
