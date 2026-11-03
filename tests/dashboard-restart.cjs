/* Run after Compose down/up, with ASF_SMOKE_OUTPUT from dashboard-smoke.cjs.
 * Reads private browser state outside repo; verifies the existing session and data.
 */
const { chromium } = require(process.env.ASF_PLAYWRIGHT_PATH || "playwright");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const out = process.env.ASF_SMOKE_OUTPUT;
const base = process.env.ASF_SMOKE_URL || "http://127.0.0.1:13003";
const evidence = JSON.parse(fs.readFileSync(path.join(out, "evidence.json"), "utf8"));
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      storageState: path.join(out, "private-storage-state.json"),
      viewport: { width: 1440, height: 1000 },
    });
    const me = await context.request.get(base + "/api/auth/me");
    assert.equal(me.status(), 200);
    const detail = await (await context.request.get(base + "/api/runs/" + evidence.run_id)).json();
    assert.equal(detail.run.status, "waiting_integration");
    assert.equal(detail.run.spec_version, 2);
    assert.equal(detail.artifacts.length, 4);
    assert.equal(detail.approvals.length, 2);
    assert.equal(detail.approvals[1].identity_source, "authenticated_session");
    const history = await (await context.request.get(base + "/api/runs/" + evidence.run_id + "/events?limit=100")).json();
    assert.equal(history.items.at(-1).kind, "run.waiting_integration");
    const page = await context.newPage();
    await page.goto(base + "/runs/" + evidence.run_id);
    await page.locator(".role-tile").first().waitFor();
    await page.waitForFunction(n => document.querySelectorAll(".timeline li").length === n, history.items.length);
    await page.screenshot({ path: path.join(out, "after-restart.png"), fullPage: true });
    evidence.restart = { session_persisted: true, status: detail.run.status, spec_version: 2,
      artifacts: 4, approvals: 2, events: history.items.length, timeline_replayed: true };
    fs.writeFileSync(path.join(out, "evidence.json"), JSON.stringify(evidence, null, 2));
    console.log("PASS Compose down/up retains session, artifacts, approvals and timeline replay");
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
