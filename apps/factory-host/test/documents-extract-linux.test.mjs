import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runDocumentWorker } from "../dist/documents/runner.js";
import { docWorkerConfig } from "../dist/documents/config.js";

const { python } = docWorkerConfig({});
const script = fileURLToPath(new URL("../workers/doc_worker.py", import.meta.url));
const linux = process.platform === "linux" && existsSync(python) && existsSync("/usr/bin/bwrap");
function tinyPdf() {
  const stream = label => { const text = `BT /F1 12 Tf 20 100 Td (${label}) Tj ET\n`; return `<< /Length ${text.length} >>\nstream\n${text}endstream`; };
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Count 2 /Kids [3 0 R 5 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 7 0 R >> >> >>", stream("Tiny PDF one"),
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>", stream("Tiny PDF two"),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let text = "%PDF-1.4\n"; const offsets = [0];
  for (const [i, object] of objects.entries()) { offsets.push(text.length); text += `${i + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = text.length;
  text += `xref\n0 ${offsets.length}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  return Buffer.from(text + `trailer\n<< /Root 1 0 R /Size ${offsets.length} >>\nstartxref\n${xref}\n%%EOF\n`);
}
test("real bubblewrapped worker extracts tiny PDF/XLSX/CSV samples", { skip: !linux && "Requires Linux, bubblewrap and the installed document-worker venv", timeout: 120000 }, async t => {
  const result = await runDocumentWorker(tinyPdf(), "application/pdf", { enabled: true, python, script });
  assert.equal(result.status, "done"); assert.equal(result.result.pages, 2);
  assert.match(result.result.markdown, /<!-- page 1 -->\s+Tiny PDF one/); assert.match(result.result.markdown, /<!-- page 2 -->\s+Tiny PDF two/);
  assert.deepEqual(result.result.outline.map(entry => [entry.title, entry.page]), [["Trang 1", 1], ["Trang 2", 2]]);
  const csv = await runDocumentWorker(Buffer.from("name,value\nalpha,2\n"), "text/csv", { enabled: true, python, script });
  assert.equal(csv.status, "done"); assert.match(csv.result.markdown, /alpha/);
  assert.equal(csv.result.pages, null);
  const available = spawnSync(python, ["-I", "-c", "import openpyxl"], { stdio: "ignore" }).status === 0;
  await t.test("XLSX sheet headings through MarkItDown", { skip: !available && "openpyxl is unavailable in the document-worker venv" }, async () => {
    // Trusted fixture generation; untrusted input is converted only through the isolated runner.
    const sample = execFileSync(python, ["-I", "-c", "import io,sys,openpyxl; w=openpyxl.Workbook(); w.active.title='Numbers'; w.active.append(['alpha',2]); b=io.BytesIO(); w.save(b); sys.stdout.buffer.write(b.getvalue())"]);
    const xlsx = await runDocumentWorker(sample, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", { enabled: true, python, script });
    assert.equal(xlsx.status, "done"); assert.equal(xlsx.result.pages, null); assert.match(xlsx.result.markdown, /alpha/);
    assert.ok(xlsx.result.outline.some(entry => entry.title === "Numbers"));
  });
});
