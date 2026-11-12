import assert from "node:assert/strict";
import { test } from "node:test";
import { extractText, extractionPolicy, markdownOutline } from "../dist/documents/policy.js";
import { MAX_TEXT } from "../dist/documents/result.js";
import { extractionFixture } from "./documents-extract-fixture.mjs";

test("text outline preserves character offsets, heading levels and CRLF, ignoring fenced code", () => {
  const text = "# Root\r\nĐề mục\n```md\n## hidden\n````\n~~~\n# hidden too\n~~~~\n## Child ###\n###### Last\n####### no\n";
  assert.deepEqual(markdownOutline(text), [[1, "Root", 0], [2, "Child", text.indexOf("## Child")], [6, "Last", text.indexOf("###### Last")]]
    .map(([level, title, offset]) => ({ level, title, offset, page: null })));
  const result = extractText(Buffer.from(text)); assert.equal(result.markdown, text); assert.equal(result.pages, null);
  assert.deepEqual(result.warnings, []);
});
test("empty text is valid and invalid UTF8 is refused", () => {
  assert.deepEqual(extractText(Buffer.alloc(0)), { markdown: "", pages: null, outline: [], metadata: { title: null, author: null, language: null }, warnings: [] });
  assert.throws(() => extractText(Buffer.from([0xff, 0xfe])));
});
test("text limits cap headings/titles and truncate without splitting surrogate pairs", () => {
  assert.equal(markdownOutline(("# Heading\n").repeat(501)).length, 500);
  assert.equal(markdownOutline("# " + "a".repeat(201))[0].title.length, 200);
  const result = extractText(Buffer.from("a".repeat(MAX_TEXT - 1) + "😀"));
  assert.equal(result.markdown.length, MAX_TEXT - 1); assert.deepEqual(result.warnings, ["truncated-text"]);
});
for (const mediaType of ["text/plain", "text/markdown", "text/csv", "application/json"]) {
  test(`${mediaType} extracts in process even with the worker disabled`, async t => {
    const f = extractionFixture(t, { enabled: false, python: "missing", script: "missing" });
    const row = f.add({ mediaType, bytes: Buffer.from("# Text\ninprocessbody") });
    assert.equal(extractionPolicy(mediaType), "text"); f.enqueue(row);
    assert.equal(f.record(row).status, "pending"); assert.equal((await f.completed(row)).status, "done");
    assert.equal(f.service.text(row.projectId, row.artifactId, 1), "# Text\ninprocessbody");
  });
}
