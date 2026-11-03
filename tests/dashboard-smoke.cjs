/* Focused Phase 3 acceptance against an isolated dev stack, using a fresh browser.
 * npm install --prefix <temporary-tools-dir> playwright@1.56.1
 * npx playwright install chromium
 * ASF_PLAYWRIGHT_PATH=<tools-dir>/node_modules/playwright
 * ASF_SMOKE_CREDENTIALS=<outside-repo JSON: username,password>
 * ASF_SMOKE_OUTPUT=<outside-repo evidence dir> node tests/dashboard-smoke.cjs
 * Creates synthetic data. Production acceptance requires explicit ASF_SMOKE_DEPLOY_ACCEPTANCE=1.
 */
const { chromium } = require(process.env.ASF_PLAYWRIGHT_PATH || "playwright");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const credentials = JSON.parse(fs.readFileSync(process.env.ASF_SMOKE_CREDENTIALS, "utf8"));
const base = process.env.ASF_SMOKE_URL || "http://127.0.0.1:13003";
const deployed = process.env.ASF_SMOKE_DEPLOY_ACCEPTANCE === "1";
if (new URL(base).hostname !== "127.0.0.1" && !deployed) {
  throw new Error("Non-local acceptance requires ASF_SMOKE_DEPLOY_ACCEPTANCE=1 (creates synthetic data)");
}
const phase = deployed ? "Phase 4" : "Phase 3";
const out = process.env.ASF_SMOKE_OUTPUT;
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const suffix = Date.now().toString(36);
  const evidence = { mode: "mock", browser: "isolated Chromium", checks: [] };
  async function check(name, fn) { await fn(); evidence.checks.push(name); console.log("PASS " + name); }
  try {
    await check("unauthenticated redirect and login", async () => {
      await page.goto(base);
      await page.waitForURL("**/login");
      await page.screenshot({ path: path.join(out, "login.png"), fullPage: true });
      await page.getByLabel("Tài khoản", { exact: true }).fill(credentials.username);
      await page.getByLabel("Mật khẩu", { exact: true }).fill(credentials.password);
      await page.getByRole("button", { name: "Đăng nhập →" }).click();
      await page.getByRole("heading", { name: "Dự án của bạn" }).waitFor();
    });
    await check("create project through UI", async () => {
      await page.getByRole("button", { name: "+ Tạo dự án" }).click();
      await page.getByLabel("Tên dự án", { exact: true }).fill(phase + " — Dashboard acceptance (synthetic)");
      await page.getByLabel("Mã dự án", { exact: true }).fill((deployed ? "phase4-" : "phase3-") + suffix);
      await page.getByLabel("Mô tả", { exact: true }).fill("Kiểm chứng dashboard, phân quyền và phê duyệt. Dữ liệu mô phỏng.");
      await page.getByRole("button", { name: "Lưu dự án" }).click();
      await page.getByRole("link").filter({ has: page.locator("code", { hasText: (deployed ? "phase4-" : "phase3-") + suffix }) }).click();
      await page.getByRole("heading", { name: "Cấu hình dự án" }).waitFor();
      evidence.project_id = page.url().split("/").pop();
      await page.screenshot({ path: path.join(out, "project.png"), fullPage: true });
    });
    await check("create mock run and inspect six roles and artifacts", async () => {
      await page.getByLabel("Yêu cầu", { exact: true }).fill("Xây dựng cổng hỗ trợ nội bộ: tiếp nhận yêu cầu, phân công và theo dõi trạng thái. Đây là dữ liệu kiểm chứng mô phỏng Phase 3.");
      await page.getByRole("button", { name: "Tạo run →" }).click();
      await page.waitForURL("**/runs/*");
      evidence.run_id = page.url().split("/").pop();
      await page.getByRole("button", { name: "Duyệt spec", exact: true }).waitFor({ timeout: 60000 });
      assert.equal(await page.locator(".role-tile").count(), 6);
      assert.equal(await page.locator(".role-tile").getByText("Chưa triển khai", { exact: true }).count(), 4);
      assert.equal(await page.locator(".artifact").count(), 2);
      await page.getByText("● Trực tiếp", { exact: true }).waitFor();
      await page.screenshot({ path: path.join(out, "run-waiting.png"), fullPage: true });
    });
    await check("refresh keeps session, run and timeline", async () => {
      await page.reload();
      await page.getByRole("button", { name: "Duyệt spec", exact: true }).waitFor();
      await page.locator(".timeline li").first().waitFor();
      const ids = await page.locator(".timeline small").allTextContents();
      assert.equal(ids.length, new Set(ids.map(x => x.split(" · ")[0])).size);
    });
    await check("SSE reconnect after offline replays without duplicates", async () => {
      await context.setOffline(true);
      await page.getByText("◌ Đang kết nối lại · dự phòng 10s", { exact: true }).waitFor();
      await context.setOffline(false);
      await page.getByText("● Trực tiếp", { exact: true }).waitFor({ timeout: 30000 });
      const ids = await page.locator(".timeline small").allTextContents();
      assert.equal(ids.length, new Set(ids.map(x => x.split(" · ")[0])).size);
    });
    await check("reject, retry creates v2 with retained v1 history", async () => {
      await page.getByLabel("Nhận xét / lý do (bắt buộc)").fill("Cần bổ sung tiêu chí nghiệm thu trước khi duyệt.");
      await page.getByRole("button", { name: "Từ chối spec", exact: true }).click();
      assert.equal(await page.getByRole("button", { name: "Xác nhận quyết định" }).isEnabled(), false);
      await page.getByRole("checkbox").check();
      await page.getByRole("button", { name: "Xác nhận quyết định" }).click();
      await page.getByRole("button", { name: "Thử lại với phiên bản mới" }).waitFor();
      await page.getByRole("button", { name: "Thử lại với phiên bản mới" }).click();
      await page.getByRole("button", { name: "Duyệt spec", exact: true }).waitFor({ timeout: 60000 });
      assert.equal(await page.locator(".artifact").count(), 4);
      await page.getByRole("heading", { name: "Yêu cầu · v2" }).waitFor();
    });
    await check("approve explicit v2 and reach integration boundary", async () => {
      await page.getByLabel("Nhận xét / lý do (bắt buộc)").fill("Đã xem spec v2 mô phỏng; chấp thuận cho kiểm chứng dashboard.");
      await page.getByRole("button", { name: "Duyệt spec", exact: true }).click();
      await page.getByRole("heading", { name: "Xác nhận phê duyệt · spec v2" }).waitFor();
      await page.getByRole("checkbox").check();
      await page.getByRole("button", { name: "Xác nhận quyết định" }).click();
      await page.getByText("Đã qua gate phê duyệt và đang chờ tích hợp Agent ở Phase 5.", { exact: true }).waitFor({ timeout: 60000 });
      assert.equal(await page.locator(".approval-row").count(), 2);
      await page.screenshot({ path: path.join(out, "run-approved.png"), fullPage: true });
    });
    await check("admin creates viewer through UI", async () => {
      await page.getByRole("link", { name: "◉ Tài khoản" }).click();
      evidence.viewer_username = "viewer-" + suffix;
      await page.getByLabel("Tên đăng nhập", { exact: true }).fill(evidence.viewer_username);
      const password = crypto.randomBytes(20).toString("base64url");
      await page.getByLabel("Mật khẩu (12–128 ký tự)").fill(password);
      await page.getByRole("button", { name: "Tạo tài khoản", exact: true }).click();
      await page.getByRole("cell", { name: evidence.viewer_username, exact: true }).waitFor();
      const viewer = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const vp = await viewer.newPage();
      await vp.goto(base + "/login");
      await vp.getByLabel("Tài khoản", { exact: true }).fill(evidence.viewer_username);
      await vp.getByLabel("Mật khẩu", { exact: true }).fill(password);
      await vp.getByRole("button", { name: "Đăng nhập →" }).click();
      await vp.getByRole("heading", { name: "Dự án của bạn" }).waitFor();
      assert.equal(await vp.getByRole("button", { name: "+ Tạo dự án" }).count(), 0);
      await vp.goto(base + "/runs/" + evidence.run_id);
      await vp.getByText("Bạn có quyền viewer: xem dữ liệu và lịch sử. Quyền phê duyệt thuộc approver/admin.", { exact: true }).waitFor();
      assert.equal(await vp.getByRole("button", { name: "Duyệt spec", exact: true }).count(), 0);
      const code = await vp.evaluate(async (runId) => {
        const me = await (await fetch("/api/auth/me")).json();
        return (await fetch(`/api/runs/${runId}/cancel`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": me.csrf_token }, body: JSON.stringify({ comment: "Viewer must be denied" }) })).status;
      }, evidence.run_id);
      assert.equal(code, 403);
      await vp.screenshot({ path: path.join(out, "viewer.png"), fullPage: true });
      await viewer.close();
    });
    await check("desktop and mobile layouts fit viewport", async () => {
      await page.goto(base + "/runs/" + evidence.run_id);
      await page.getByRole("heading", { name: "Sáu Agent" }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(out, "mobile.png"), fullPage: true });
    });
    await check("no browser runtime errors", async () => assert.deepEqual(errors, []));
    // Preserve private storage state outside the repository for restart verification.
    await context.storageState({ path: path.join(out, "private-storage-state.json") });
    fs.writeFileSync(path.join(out, "evidence.json"), JSON.stringify(evidence, null, 2));
  } catch (e) {
    await page.screenshot({ path: path.join(out, "failure.png"), fullPage: true });
    throw e;
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
