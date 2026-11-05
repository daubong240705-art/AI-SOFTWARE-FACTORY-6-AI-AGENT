// Application-code smoke tests with minimal DOM stubs. No browser/layout claims.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { resolve } from "node:path";
const html = readFileSync(
  resolve(
    import.meta.dirname,
    "../../.cache/factory-v2/style-guide/index.html",
  ),
  "utf8",
);
const data = html.match(
  /<script id="design-data" type="application\/json">([\s\S]*?)<\/script>/,
)[1];
const code = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
function fixture(storageEnabled = true) {
  const events = new Map(),
    app = { innerHTML: "" },
    stored = new Map();
  const dialog = {
    open: false,
    innerHTML: "",
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
    addEventListener() {},
    setAttribute() {},
  };
  const document = {
    documentElement: { dataset: {} },
    activeElement: null,
    title: "",
    getElementById: (id) =>
      ({
        app,
        "design-data": { textContent: data },
        detail: dialog,
        "window-layer": { clientWidth: 1000, clientHeight: 650 },
        main: { focus() {} },
      })[id] ?? null,
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: (name, callback) =>
      events.set(name, [...(events.get(name) ?? []), callback]),
  };
  const window = { innerWidth: 1366, addEventListener() {} };
  const context = vm.createContext({
    document,
    window,
    Intl,
    Map,
    Set,
    JSON,
    Number,
    Error,
    structuredClone,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    localStorage: {
      getItem: (key) => {
        if (!storageEnabled) throw Error("disabled");
        return stored.get(key) ?? null;
      },
      setItem: (key, value) => {
        if (!storageEnabled) throw Error("disabled");
        stored.set(key, value);
      },
    },
  });
  vm.runInContext(
    code +
      "\nglobalThis.fixture = {state,render,openChat,send,chatState,saveLayout,savePreferences,placeWindows};",
    context,
    { timeout: 3000 },
  );
  const api = context.fixture;
  const click = (action, id) => {
    const target = { dataset: { action, id }, closest: () => target };
    for (const callback of events.get("click") ?? []) callback({ target });
  };
  return { api, app, stored, document, window, click, dialog };
}
test("offline bundle initializes and renders all 192 theme/locale/page/view-state combinations", () => {
  const f = fixture();
  let count = 0;
  for (const theme of ["light", "dark"])
    for (const locale of ["vi", "en"])
      for (const page of [
        "board",
        "dashboard",
        "team",
        "guide",
        "settings",
        "attention",
      ])
        for (const scenario of [
          "ready",
          "loading",
          "empty",
          "error",
          "stale",
          "partial",
          "offline",
          "long-content",
        ]) {
          Object.assign(f.api.state, { theme, locale, page, scenario });
          f.api.render();
          assert(
            !f.app.innerHTML.includes("undefined"),
            `${theme}/${locale}/${page}/${scenario}`,
          );
          assert(
            f.app.innerHTML.includes(
              locale === "vi" ? "Mẫu giao diện" : "UI preview",
            ),
          );
          assert.equal(f.document.documentElement.dataset.theme, theme);
          assert.equal(f.document.documentElement.lang, locale);
          count++;
        }
  assert.equal(count, 192);
});
test("language/theme switches preserve in-memory drafts and original agent content", () => {
  const f = fixture();
  f.api.chatState("lead").draft = "Nháp tiếng Việt";
  f.click("locale", "en");
  f.click("theme", "dark");
  assert.equal(f.api.chatState("lead").draft, "Nháp tiếng Việt");
  assert(f.app.innerHTML.includes("BA đã lưu data model"));
  f.api.state.page = "settings";
  f.api.render();
  assert(f.app.innerHTML.includes("Appearance &amp; language"));
  assert(
    f.stored.get("asf-v2-design-preferences:v1").includes('"locale":"en"'),
  );
});
test("open/focus/minimize/restore/close preserves sample drafts without duplicating a conversation", () => {
  const f = fixture();
  f.api.openChat("frontend");
  f.api.openChat("frontend");
  assert.equal(
    f.api.state.windows.filter((w) => w.agentId === "frontend").length,
    1,
  );
  f.api.chatState("frontend").draft = "Still here";
  f.click("minimize", "sample-frontend");
  assert.equal(
    f.api.state.windows.find((w) => w.agentId === "frontend").mode,
    "minimized",
  );
  f.click("restore", "sample-frontend");
  assert.equal(f.api.state.activeId, "sample-frontend");
  f.click("close-window", "sample-frontend");
  f.api.openChat("frontend");
  assert.equal(f.api.chatState("frontend").draft, "Still here");
  assert(
    !f.stored.get("asf-v2-design-layout:demo-studio:v1").includes("Still here"),
  );
});
test("simulated send is isolated per agent, escapes HTML and is blocked offline", () => {
  const f = fixture();
  f.api.chatState("frontend").draft = '<img src=x onerror="bad">';
  f.api.send("frontend");
  assert.equal(f.api.chatState("frontend").messages.length, 2);
  assert.equal(f.api.chatState("backend").messages.length, 0);
  assert(f.app.innerHTML.includes("&lt;img"));
  assert(!f.app.innerHTML.includes("<img src=x"));
  f.api.state.scenario = "offline";
  f.api.chatState("frontend").draft = "Do not send";
  f.api.send("frontend");
  assert.equal(f.api.chatState("frontend").messages.length, 2);
  assert.equal(f.api.chatState("frontend").draft, "Do not send");
});
test("mobile renders only the active chat and desktop restores the other frames", () => {
  const f = fixture();
  f.api.openChat("frontend");
  f.api.openChat("backend");
  f.window.innerWidth = 390;
  f.api.render();
  assert.equal((f.app.innerHTML.match(/data-window=/g) ?? []).length, 1);
  f.window.innerWidth = 1440;
  f.api.render();
  assert.equal((f.app.innerHTML.match(/data-window=/g) ?? []).length, 3);
});
test("disabled browser storage uses memory and keeps the fixture usable", () => {
  const f = fixture(false);
  f.click("theme", "dark");
  f.api.openChat("frontend");
  assert(f.app.innerHTML.includes("Không lưu được"));
  assert.equal(f.api.state.theme, "dark");
});
test("stale team data does not claim current working counts", () => {
  const f = fixture();
  Object.assign(f.api.state, { scenario: "stale", page: "team" });
  f.api.render();
  assert(!f.app.innerHTML.includes("3 Đang làm"));
  assert(f.app.innerHTML.includes("Chưa xác định"));
});
