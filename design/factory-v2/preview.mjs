import {
  clampBounds,
  createWindow,
  displayBounds,
  restoreLayout,
  serializeLayout,
} from "./window-state.mjs";

// Offline fixture: no API/model/DB. UI chrome is translated; work content stays original.
const { seed, tokens, screens, components, resources } = JSON.parse(
  document.getElementById("design-data").textContent,
);
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const paths = {
  home: '<path d="m3 10 9-7 9 7v11h-6v-7H9v7H3Z"/>',
  inbox: '<path d="M5 4h14l3 12v4H2v-4Z M2 14h6l2 3h4l2-3h6"/>',
  team: '<circle cx="9" cy="7" r="3"/><path d="M2 21v-3a7 7 0 0 1 14 0v3 M17 4a3 3 0 0 1 0 6 M22 21v-3a7 7 0 0 0-4-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  close: '<path d="m6 6 12 12 M18 6 6 18"/>',
  expand: '<path d="M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5"/>',
  minus: '<path d="M5 12h14"/>',
  chat: '<path d="M21 15a3 3 0 0 1-3 3H7l-4 3V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3Z"/>',
  move: '<path d="m8 4 4-3 4 3 M12 1v22 M8 20l4 3 4-3 M4 8l-3 4 3 4 M1 12h22 M20 8l3 4-3 4"/>',
  resize: '<path d="m7 21 14-14 M13 21l8-8 M19 21l2-2"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] ?? paths.chat}</svg>`;
const byId = (items, id) => items.find((item) => item.id === id);
const state = {
  page: "board",
  scenario: "ready",
  theme: "light",
  locale: "vi",
  windows: [],
  activeId: null,
  storageError: "",
  chats: new Map(),
  focusTrigger: null,
};
const prefKey = "asf-v2-design-preferences:v1";
const layoutKey = "asf-v2-design-layout:demo-studio:v1";
const labels = () => resources[state.locale];
const text = (key, params = {}) =>
  String(labels().preview[key] ?? key).replace(/\{(\w+)\}/g, (_, name) =>
    String(params[name] ?? ""),
  );
const t = (key, params) => escape(text(key, params));
const agentName = (id) => byId(seed.agents, id)?.name ?? text("unassigned");
const projectForAgent = (id) => seed.projects[id === "researcher" ? 1 : 0];
const initials = (name) =>
  escape(
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0])
      .join(""),
  );
const avatar = (id) =>
  `<span class="avatar" aria-hidden="true">${initials(agentName(id))}</span>`;
const badge = (activity, label) =>
  `<span class="badge ${escape(activity)}">${escape(label ?? labels().activity[activity] ?? activity)}</span>`;
const currentScenario = () => byId(seed.scenarios, state.scenario);
const offline = () => currentScenario().viewState === "offline";
const stale = () => ["stale", "offline"].includes(currentScenario().viewState);
const pendingDecisions = () =>
  seed.decisions.filter((item) => item.status === "pending");
const button = (action, label, id = "", image = "", cls = "") =>
  `<button type="button" class="${cls}" data-action="${action}" data-id="${escape(id)}">${image ? icon(image) : ""}${escape(label)}</button>`;
const iconButton = (action, key, id, image, extra = "") =>
  `<button type="button" class="ghost icon-button" data-action="${action}" data-id="${escape(id)}" aria-label="${t(key)}" title="${t(key)}" ${extra}>${icon(image)}</button>`;
const menu = (name, items, action) =>
  `<details class="select"><summary>${escape(name)}${icon("down")}</summary><div class="select-menu">${items.map((item) => button(action, item.label, item.id)).join("")}</div></details>`;
function area() {
  const el = document.getElementById("window-layer");
  return { width: el?.clientWidth ?? 0, height: el?.clientHeight ?? 0 };
}
function savePreferences() {
  try {
    localStorage.setItem(
      prefKey,
      JSON.stringify({
        schemaVersion: 1,
        theme: state.theme,
        locale: state.locale,
      }),
    );
  } catch {
    state.storageError = "storageError";
  }
}
function saveLayout() {
  try {
    localStorage.setItem(
      layoutKey,
      JSON.stringify(serializeLayout(state.windows, state.activeId)),
    );
  } catch {
    state.storageError = "storageError";
  }
}
function loadPreferences() {
  try {
    const raw = localStorage.getItem(prefKey);
    if (!raw) return;
    const pref = JSON.parse(raw);
    if (
      pref.schemaVersion !== 1 ||
      !["light", "dark", "system"].includes(pref.theme) ||
      !["vi", "en"].includes(pref.locale)
    )
      throw Error();
    state.theme = pref.theme;
    state.locale = pref.locale;
  } catch {
    state.storageError = "dataError";
  }
}
const systemTheme = matchMedia("(prefers-color-scheme: dark)");
function applyTheme() {
  document.documentElement.dataset.theme =
    state.theme === "system"
      ? systemTheme.matches
        ? "dark"
        : "light"
      : state.theme;
  document.documentElement.lang = state.locale;
  document.title = text("title");
}
function chatState(agentId) {
  if (!state.chats.has(agentId))
    state.chats.set(agentId, {
      draft: "",
      messages: agentId === "lead" ? [...seed.messages] : [],
      scroll: 0,
    });
  return state.chats.get(agentId);
}
function sidebar() {
  return `<aside class="sidebar"><div class="brand"><span class="brand-dot"></span><span class="brand-name">factory</span></div><nav class="nav" aria-label="${t("mainNav")}">${[
    ["dashboard", "home"],
    ["attention", "inbox"],
    ["team", "team"],
  ]
    .map(
      ([id, image]) =>
        `<button type="button" data-action="page" data-id="${id}" title="${escape(labels().global[id])}" ${state.page === id ? 'class="active" aria-current="page"' : ""}>${icon(image)}<span class="nav-text grow">${escape(labels().global[id])}</span>${id === "attention" ? `<span class="counter">${pendingDecisions().length}</span>` : ""}</button>`,
    )
    .join(
      "",
    )}</nav><div class="nav-label">${escape(labels().global.projects)}</div><nav class="nav project-nav" aria-label="${t("sampleProjects")}">${seed.projects.map((project, index) => `<button type="button" data-action="${index ? "notice" : "page"}" data-id="${index ? project.id : "board"}" title="${escape(project.name)}" class="${state.page === "board" && !index ? "active" : ""}"><span class="mono-avatar">${escape(project.code)}</span><span class="nav-text">${escape(project.name)}</span></button>`).join("")}</nav><div class="sidebar-footer"><span class="avatar">A</span><span class="grow meta">${t("local")}</span>${iconButton("page", "settings", "settings", "settings")}</div></aside>`;
}
function header() {
  return `<header class="topbar"><span class="muted grow header-title">${escape(state.page === "board" ? "Factory Studio" : (labels().global[state.page] ?? text(state.page)))}</span>${button("page", text("settings"), "settings", "settings", "ghost")}${button("page", text("guide"), "guide", "", "ghost")}</header>${
    state.page === "board"
      ? `<nav class="projectbar" aria-label="${t("inProject")}"><span class="project-title">Factory Studio</span><div class="project-tabs">${labels()
          .projectTabs.map((tab) =>
            button(
              tab.id === "board" ? "page" : "screen",
              tab.label,
              {
                reports: "UI-05",
                automations: "UI-02",
                scheduled: "UI-06",
                git: "UI-07",
              }[tab.id] ?? (tab.id === "board" ? "board" : "inferred"),
              "",
              tab.id === "board" ? "active" : "",
            ),
          )
          .join("")}</div></nav>`
      : ""
  }<div class="preview-strip"><strong>${t("sample")}</strong><span class="preview-description grow">${t("noRuntime")}</span>${menu(
    text("state") +
      ": " +
      (state.scenario === "long-content"
        ? text("longContent")
        : labels().viewStates[currentScenario().viewState]),
    seed.scenarios.map((item) => ({
      id: item.id,
      label:
        item.id === "long-content"
          ? text("longContent")
          : labels().viewStates[item.viewState],
    })),
    "scenario",
  )}</div>${state.storageError ? `<div class="notice" role="status">${t(state.storageError)}</div>` : ""}`;
}
const scenarioDescription = () =>
  text(
    "scenario" +
      ({ "long-content": "Long" }[state.scenario] ??
        state.scenario[0].toUpperCase() + state.scenario.slice(1)),
  );
function viewNotice() {
  return ["ready", "loading", "empty", "error"].includes(
    currentScenario().viewState,
  )
    ? ""
    : `<div class="notice warning" role="status">${escape(scenarioDescription())}</div>`;
}
function unavailable() {
  switch (currentScenario().viewState) {
    case "loading":
      return `<div class="card card-body" aria-busy="true"><p role="status">${t("loading")}</p>${Array.from({ length: 6 }, () => '<div class="skeleton"></div>').join("")}</div>`;
    case "empty":
      return `<div class="card state-empty"><h2>${t("emptyTitle")}</h2><p class="muted">${t("emptyBody")}</p>${button("open-chat", text("talkLead"), "lead", "chat", "primary")}</div>`;
    case "error":
      return `<div class="card state-empty" role="alert"><h2>${t("errorTitle")}</h2><p class="muted">${t("errorBody")}</p>${button("scenario", text("retryFixture"), "ready")}</div>`;
    default:
      return "";
  }
}
function ticket(task) {
  return `<button type="button" class="ticket ${task.status === "review" ? "review" : ""}" data-action="task" data-id="${escape(task.id)}"><span class="code">${escape(task.code)}</span><span class="ticket-title">${escape(state.scenario === "long-content" && task.id === "fs-10" ? currentScenario().taskTitle : task.title)}</span>${task.reason ? `<span class="meta">${escape(task.reason)}</span>` : ""}<span class="ticket-footer"><span class="chips">${task.labels.map((label) => `<span class="chip">${escape(label)}</span>`).join("")}</span>${task.ownerId ? avatar(task.ownerId) : `<span class="meta">${t("unassigned")}</span>`}</span></button>`;
}
function board() {
  return (
    unavailable() ||
    `<section class="board-view">${viewNotice()}<div class="notice row"><strong class="grow">${t("attention", { count: pendingDecisions().length })}</strong>${button("page", text("view"), "attention", "", "ghost")}</div><div class="toolbar"><span class="muted grow">${t("tasks", { count: seed.tasks.length })}</span>${menu(
      text("labels"),
      ["FE", "BE", "BA"].map((id) => ({ id, label: id })),
      "notice",
    )}${menu(
      text("priority"),
      ["high", "normal"].map((id) => ({ id, label: text(id) })),
      "notice",
    )}</div><div class="board-scroll">${labels()
      .workflowPreset.map(
        (column) =>
          `<section class="column" aria-label="${escape(column.label)}"><header class="column-header"><strong class="grow">${escape(column.label)}</strong><span class="meta">${seed.tasks.filter((task) => task.status === column.id).length}</span></header><div class="column-body">${seed.tasks
            .filter((task) => task.status === column.id)
            .map(ticket)
            .join("")}</div></section>`,
      )
      .join("")}</div></section>`
  );
}
function decisions() {
  return (
    pendingDecisions()
      .map(
        (decision) =>
          `<article class="decision"><span class="code">${escape(byId(seed.tasks, decision.taskId).code)}</span><h3>${escape(decision.question)}</h3><p class="muted">${escape(decision.reason)}</p><p class="meta">${t("recommendation")}: ${escape(decision.recommendation)}</p><div>${button("decision", labels().actions.reply, decision.id)}</div></article>`,
      )
      .join("") || `<p class="card-body muted">${t("noDecisions")}</p>`
  );
}
function dashboard() {
  return (
    unavailable() ||
    `<section class="stack">${viewNotice()}<div><p class="meta">${escape(new Intl.DateTimeFormat(state.locale, { dateStyle: "full", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(seed.clock)))}</p><h1>${t("greeting")}</h1></div><div class="home-grid"><div class="stack"><div class="card quick-ask"><textarea aria-label="${t("quickAsk")}" data-draft="lead" placeholder="${t("prompt")}" ${offline() ? "disabled" : ""}>${escape(chatState("lead").draft)}</textarea><div class="row"><strong class="grow">Factory Studio · Lead</strong>${button("send", labels().actions.send, "lead", "", "accent")}</div></div><section class="card"><div class="card-header"><h2>${t("activity")}</h2></div>${seed.activity.map((item) => `<div class="activity-row">${avatar(item.actorId)}<div class="grow"><p><strong>${escape(agentName(item.actorId))}</strong> ${escape(item.text)}</p><p class="meta">${escape(byId(seed.tasks, item.taskId).code)} · ${escape(item.time)}</p></div></div>`).join("")}</section></div><aside class="stack"><section class="card"><div class="card-header"><h2>${escape(labels().global.attention)}</h2></div>${decisions()}</section><section class="card card-body stack"><h2>${t("needsAttention")}</h2><p class="muted">${t("parallel")}</p></section></aside></div></section>`
  );
}
function agentRow(agent) {
  return `<div class="agent-row ${agent.parentId ? "child" : ""}">${avatar(agent.id)}<div class="agent-context"><strong>${escape(state.scenario === "long-content" && agent.id === "analyst" ? currentScenario().agentName : agent.name)}</strong><p class="muted">${escape(agent.step)}</p>${agent.taskId ? `<p class="meta">${escape(byId(seed.tasks, agent.taskId).code)} · ${escape(byId(seed.tasks, agent.taskId).title)}</p>` : ""}${agent.reason ? `<p class="meta">${escape(agent.reason)}</p>` : ""}<p class="meta">${escape(agent.runtime)} · ${escape(stale() ? labels().readiness.stale : labels().readiness[agent.readiness])}</p></div><div class="agent-actions">${badge(stale() ? "idle" : agent.activity, stale() ? text("unknown") : undefined)}<button type="button" class="ghost icon-button" data-action="open-chat" data-id="${escape(agent.id)}" aria-label="${t("openChat", { name: agent.name })}" title="${t("openChat", { name: agent.name })}">${icon("chat")}</button></div></div>`;
}
function team() {
  return (
    unavailable() ||
    `<section class="stack">${viewNotice()}<div><h1>${escape(labels().global.team)}</h1><p class="muted">${t("teamIntro")}</p></div><div class="notice"><strong>${t("sampleConnection")}</strong><p class="meta">${t("noSessions")}</p></div><div class="session-grid"><section class="card"><div class="card-header stack"><h2>Factory Studio</h2><div class="row wrap">${["working", "idle", "waiting"].map((mode) => badge(stale() ? "idle" : mode, stale() ? text("unknown") : `${seed.agents.filter((a) => a.id !== "researcher" && a.activity === mode).length} ${labels().activity[mode]}`)).join("")}</div></div>${seed.agents
      .filter((a) => a.id !== "researcher")
      .map(agentRow)
      .join(
        "",
      )}</section><section class="card"><div class="card-header"><h2>${escape(seed.projects[1].name)}</h2></div>${agentRow(byId(seed.agents, "researcher"))}</section></div></section>`
  );
}
function settings() {
  return `<section class="stack"><h1>${t("settings")}</h1><div class="card card-body stack"><div class="field"><strong>${t("theme")}</strong><div class="row wrap">${["light", "dark", "system"].map((mode) => `<button type="button" data-action="theme" data-id="${mode}" aria-pressed="${state.theme === mode}">${t(mode)}</button>`).join("")}</div></div><div class="field"><strong>${t("language")}</strong><div class="row">${["vi", "en"].map((locale) => `<button type="button" data-action="locale" data-id="${locale}" aria-pressed="${state.locale === locale}">${locale === "vi" ? "Tiếng Việt" : "English"}</button>`).join("")}</div></div><p class="muted">${t("preferencesNote")}</p><div>${button("reset-layout", text("resetLayout"))}</div></div></section>`;
}
function guide() {
  const palette = tokens.themes[document.documentElement.dataset.theme];
  return `<section class="stack"><h1>${t("guide")}</h1><p class="muted">${t("guideIntro")}</p><div class="guide-grid"><section class="card card-body stack"><h2>${t("colorsType")}</h2><div class="swatches">${["canvas", "surface", "raised", "accent", "text", "muted"].map((name) => `<div class="swatch"><span class="swatch-color" style="background:${palette[name]}"></span><strong>${name}</strong><span class="code">${palette[name]}</span></div>`).join("")}</div><h2>${t("glyphSample")}</h2><p class="font-sample">${t("glyphSample")}</p><p class="meta">${t("fontNote")}</p><pre class="sample-code"><code>WorkItem {{id, revision, status}}\n  const ready = true;</code></pre></section><section class="card card-body stack"><h2>${t("controls")}</h2><div class="row wrap">${button("notice", labels().actions.continue, "", "", "primary")}${button("notice", labels().actions.send, "", "", "accent")}<button type="button" disabled>${t("unavailable")}</button></div><div class="field"><label for="demo-field">${t("projectName")}</label><input id="demo-field" value="Factory Studio" aria-describedby="demo-error" aria-invalid="true"><span id="demo-error" class="meta error">${t("validation")}</span></div>${menu(
    text("customMenu"),
    [
      { id: "one", label: text("shortOption") },
      { id: "two", label: text("longOption") },
    ],
    "notice",
  )}<div class="state-list">${["idle", "working", "waiting", "blocked"].map((mode) => badge(mode)).join("")}</div><p class="meta">${t("menuNote")}</p></section><section class="card card-body stack"><h2>${t("screenChecklist")}</h2>${screens.screens.map((screen) => button("screen", `${screen.id} · ${labels().screenNames[screen.id]}`, screen.id)).join("")}<p class="meta">${t("originalContracts")}</p></section><section class="card card-body stack"><h2>${t("windows")}</h2><p class="muted">${t("windowNote")}</p><div class="row wrap">${seed.agents.map((agent) => button("open-chat", agent.name, agent.id, "chat")).join("")}</div><h2>${t("viewStates")}</h2><div class="state-list">${components.viewStates.map((mode) => button("scenario", labels().viewStates[mode], mode)).join("")}</div></section></div></section>`;
}
function chatWindows() {
  const narrow = window.innerWidth < tokens.breakpoints.mobile;
  return state.windows
    .filter(
      (item) =>
        item.mode !== "minimized" && (!narrow || item.id === state.activeId),
    )
    .map((item, index) => {
      const chat = chatState(item.agentId);
      return `<section class="chat card ${item.id === state.activeId ? "selected" : ""}" data-window="${item.id}" role="region" aria-label="${t("chatSample")} · ${escape(agentName(item.agentId))}" style="z-index:${tokens.layers.panel + index}"><header class="chat-header row" data-drag="${item.id}">${iconButton("move", "move", item.id, "move", 'data-move="true"')}${avatar(item.agentId)}<strong class="grow">${escape(agentName(item.agentId))}</strong>${iconButton("minimize", "minimize", item.id, "minus")}${iconButton("maximize", item.mode === "maximized" ? "restore" : "maximize", item.id, "expand")}${iconButton("close-window", "close", item.id, "close")}</header><div class="chat-context meta">${escape(projectForAgent(item.agentId).name)} · ${t("simulate")}</div><div class="chat-messages" data-thread="${item.agentId}" tabindex="0" aria-label="${t("messages")}">${chat.messages.map((message) => `<article class="message ${message.role === "user" ? "user" : ""}"><strong>${message.role === "user" ? t("user") : escape(agentName(item.agentId))} <span class="meta">${escape(message.time)}</span></strong><p>${escape(message.text)}</p></article>`).join("")}</div><div class="composer"><label class="sr-only" for="draft-${item.agentId}">${t("openChat", { name: agentName(item.agentId) })}</label><textarea id="draft-${item.agentId}" data-draft="${item.agentId}" placeholder="${t("prompt")}" ${offline() ? "disabled" : ""}>${escape(chat.draft)}</textarea><div class="row"><span class="meta grow">${t(item.mode)}</span><button type="button" class="accent" data-action="send" data-id="${item.agentId}" ${offline() ? "disabled" : ""}>${escape(labels().actions.send)}</button></div></div>${iconButton("resize", "resize", item.id, "resize", 'data-resize="true"')}</section>`;
    })
    .join("");
}
function tray() {
  return `<nav class="window-tray" aria-label="${t("windows")}">${button("open-chat", text("talkLead"), "lead", "chat", "primary")}${state.windows.map((item) => `<button type="button" class="tray-item" data-action="restore" data-id="${item.id}" title="${t("restore")} · ${escape(agentName(item.agentId))}" aria-pressed="${state.activeId === item.id && item.mode !== "minimized"}">${avatar(item.agentId)}<span>${escape(agentName(item.agentId))}</span>${item.mode === "minimized" ? icon("minus") : ""}</button>`).join("")}</nav>`;
}
function preserveScroll() {
  document.querySelectorAll("[data-thread]").forEach((el) => {
    chatState(el.dataset.thread).scroll = el.scrollTop;
  });
}
let observer;
function render() {
  preserveScroll();
  applyTheme();
  const views = {
    board,
    dashboard,
    team,
    guide,
    settings,
    attention: () =>
      `<section class="stack"><h1>${escape(labels().global.attention)}</h1><p class="muted">${t("decisionIntro")}</p><div class="card">${decisions()}</div></section>`,
  };
  observer?.disconnect();
  document.getElementById("app").innerHTML =
    `<div class="app">${sidebar()}<div class="main">${header()}<div class="workspace"><main class="content" id="main" tabindex="-1">${views[state.page]()}</main><div id="window-layer" class="window-layer">${chatWindows()}</div></div>${tray()}</div></div>`;
  placeWindows();
  document.querySelectorAll("[data-thread]").forEach((el) => {
    el.scrollTop = chatState(el.dataset.thread).scroll;
  });
  observer?.observe(document.querySelector(".workspace"));
}
function placeWindows() {
  const available = area();
  const narrow = window.innerWidth < tokens.breakpoints.mobile;
  document.querySelectorAll("[data-window]").forEach((el) => {
    const item = state.windows.find((w) => w.id === el.dataset.window);
    const bounds = displayBounds(item, available, tokens.window, narrow);
    Object.assign(el.style, {
      left: bounds.x + "px",
      top: bounds.y + "px",
      width: bounds.width + "px",
      height: bounds.height + "px",
    });
  });
}
document.addEventListener("focusin", (event) => {
  const frame = event.target.closest("[data-window]");
  if (frame) focusWindow(frame.dataset.window);
});
function focusWindow(id) {
  const index = state.windows.findIndex((item) => item.id === id);
  if (index < 0) return;
  const [item] = state.windows.splice(index, 1);
  state.windows.push(item);
  state.activeId = id;
  document.querySelectorAll("[data-window]").forEach((el) => {
    el.style.zIndex =
      tokens.layers.panel +
      state.windows.findIndex((w) => w.id === el.dataset.window);
    el.classList.toggle("selected", el.dataset.window === id);
  });
}
function openChat(agentId) {
  if (!byId(seed.agents, agentId)) return;
  const existing = state.windows.find((item) => item.agentId === agentId);
  if (existing) {
    existing.mode = existing.mode === "minimized" ? "floating" : existing.mode;
    focusWindow(existing.id);
  } else {
    if (state.windows.length >= tokens.window.maxOpen) {
      dialog(text("windows"), `<p>${t("maxWindows")}</p>`);
      return;
    }
    const item = createWindow(
      agentId,
      state.windows.length,
      area(),
      tokens.window,
    );
    state.windows.push(item);
    state.activeId = item.id;
  }
  saveLayout();
  render();
  document.getElementById(`draft-${agentId}`)?.focus();
}
function dialog(title, html) {
  const el = document.getElementById("detail");
  if (el.open) el.close();
  state.focusTrigger = document.activeElement;
  el.innerHTML = `<div class="stack"><div class="row spread"><h2>${escape(title)}</h2>${iconButton("close-dialog", "close", "", "close")}</div>${html}</div>`;
  el.setAttribute("aria-label", title);
  el.showModal();
}
function send(agentId) {
  const chat = chatState(agentId);
  if (offline() || !chat.draft.trim()) return;
  chat.messages.push(
    { role: "user", time: "09:00", text: chat.draft.trim() },
    { role: "assistant", time: "09:00", text: text("reply") },
  );
  chat.draft = "";
  openChat(agentId);
  const thread = document.querySelector(`[data-thread="${agentId}"]`);
  if (thread) thread.scrollTop = thread.scrollHeight;
}
document.addEventListener("input", (event) => {
  const agentId = event.target.dataset.draft;
  if (!agentId) return;
  chatState(agentId).draft = event.target.value;
  document.querySelectorAll(`[data-draft="${agentId}"]`).forEach((el) => {
    if (el !== event.target) el.value = event.target.value;
  });
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape")
    document.querySelectorAll("details[open]").forEach((el) => {
      el.open = false;
      el.querySelector("summary").focus();
    });
  if (
    event.target.matches("[data-draft]") &&
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing &&
    event.keyCode !== 229
  ) {
    event.preventDefault();
    send(event.target.dataset.draft);
  }
  if (
    event.target.matches("[data-move], [data-resize]") &&
    ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
  ) {
    const item = state.windows.find((w) => w.id === event.target.dataset.id);
    if (
      !item ||
      item.mode !== "floating" ||
      window.innerWidth < tokens.breakpoints.mobile
    )
      return;
    event.preventDefault();
    const step = event.shiftKey ? 1 : 8;
    const dx =
      event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy =
      event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    item.bounds = clampBounds(
      {
        ...item.bounds,
        ...(event.target.matches("[data-resize]")
          ? { width: item.bounds.width + dx, height: item.bounds.height + dy }
          : { x: item.bounds.x + dx, y: item.bounds.y + dy }),
      },
      area(),
      tokens.window,
    );
    placeWindows();
    saveLayout();
  }
});
document.addEventListener("click", (event) => {
  const el = event.target.closest("[data-action]");
  if (!el) return;
  const { action, id } = el.dataset;
  if (action === "close-dialog") {
    document.getElementById("detail").close();
    return;
  }
  if (action === "page") {
    state.page = id;
    render();
    document.getElementById("main").focus();
  } else if (action === "theme" || action === "locale") {
    state[action] = id;
    savePreferences();
    render();
    document
      .querySelector(`[data-action="${action}"][data-id="${id}"]`)
      ?.focus();
  } else if (action === "scenario") {
    state.scenario = id;
    render();
  } else if (action === "open-chat") openChat(id);
  else if (action === "send") send(id);
  else if (action === "reset-layout") {
    state.windows = [createWindow("lead", 0, area(), tokens.window)];
    state.activeId = state.windows[0].id;
    saveLayout();
    render();
  } else if (
    ["minimize", "maximize", "restore", "close-window"].includes(action)
  ) {
    const item = byId(state.windows, id);
    if (!item) return;
    if (action === "close-window")
      state.windows = state.windows.filter((w) => w.id !== id);
    else if (action === "minimize") item.mode = "minimized";
    else if (action === "maximize")
      item.mode = item.mode === "maximized" ? "floating" : "maximized";
    else item.mode = item.mode === "minimized" ? "floating" : item.mode;
    state.activeId =
      action === "minimize" || action === "close-window"
        ? (state.windows.filter((w) => w.mode !== "minimized").at(-1)?.id ??
          null)
        : id;
    if (action === "restore") focusWindow(id);
    saveLayout();
    render();
    document
      .querySelector(
        `[data-action="${action === "minimize" ? "restore" : "open-chat"}"][data-id="${action === "minimize" ? id : "lead"}"]`,
      )
      ?.focus();
  } else if (action === "decision") {
    chatState("lead").draft = byId(seed.decisions, id).question + "\n";
    openChat("lead");
  } else if (action === "task") {
    const task = byId(seed.tasks, id);
    dialog(
      task.code + " · " + task.title,
      `<p class="muted">${t("assignee")}: ${escape(agentName(task.ownerId))}</p><h3>${t("taskOutput")}</h3><p>${escape(task.output)}</p><h3>${t("criteria")}</h3><ul>${task.criteria.map((value) => `<li>${escape(value)}</li>`).join("")}</ul><h3>${t("inputs")}</h3><p>${escape(task.inputRefs.map((ref) => byId(seed.documents, ref).title + " v1").join(" · ") || text("requestInput"))}</p><h3>${t("dependencies")}</h3><p>${escape(task.dependencies.map((ref) => byId(seed.tasks, ref).code).join(", ") || text("none"))}</p><p class="meta">${t("taskNote")}</p>`,
    );
  } else if (action === "screen") {
    const screen = byId(screens.screens, id);
    dialog(
      screen
        ? screen.id + " · " + labels().screenNames[id]
        : text("additionalScreen"),
      screen
        ? `<p class="meta">${t("checklistNote")} ${t("originalContracts")}</p><ul class="checklist">${[...screens.sharedChecks, ...screen.checks].map((check) => `<li><strong>${escape(check.group)}</strong> · ${escape(check.expect)}</li>`).join("")}</ul>`
        : `<p>${t("inferred")}</p>`,
    );
  } else if (!["move", "resize"].includes(action))
    dialog(text("demoAction"), `<p>${t("demoActionBody")}</p>`);
});
document
  .getElementById("detail")
  .addEventListener(
    "close",
    () => state.focusTrigger?.isConnected && state.focusTrigger.focus(),
  );
let pointer = null;
document.addEventListener("pointerdown", (event) => {
  const frame = event.target.closest("[data-window]");
  if (frame) focusWindow(frame.dataset.window);
  const resize = event.target.closest("[data-resize]");
  const header = event.target.closest("[data-drag]");
  if (!resize && (!header || event.target.closest("button"))) return;
  const id = resize?.dataset.id ?? header.dataset.drag;
  const item = byId(state.windows, id);
  if (
    !item ||
    item.mode !== "floating" ||
    window.innerWidth < tokens.breakpoints.mobile ||
    event.button !== 0
  )
    return;
  const handle = resize ?? header;
  pointer = {
    id,
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    bounds: { ...item.bounds },
    resize: !!resize,
    handle,
  };
  handle.setPointerCapture(event.pointerId);
  event.preventDefault();
});
document.addEventListener("pointermove", (event) => {
  if (!pointer || event.pointerId !== pointer.pointerId) return;
  const item = byId(state.windows, pointer.id);
  if (!item) return;
  const dx = event.clientX - pointer.x,
    dy = event.clientY - pointer.y;
  item.bounds = clampBounds(
    {
      ...pointer.bounds,
      ...(pointer.resize
        ? {
            width: pointer.bounds.width + dx,
            height: pointer.bounds.height + dy,
          }
        : { x: pointer.bounds.x + dx, y: pointer.bounds.y + dy }),
    },
    area(),
    tokens.window,
  );
  placeWindows();
});
function endPointer(event) {
  if (!pointer || event.pointerId !== pointer.pointerId) return;
  if (event.type === "pointercancel") {
    const item = byId(state.windows, pointer.id);
    if (item) item.bounds = pointer.bounds;
    placeWindows();
  }
  const handle = pointer.handle;
  const id = pointer.pointerId;
  pointer = null;
  if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
  saveLayout();
}
document.addEventListener("pointerup", endPointer);
document.addEventListener("pointercancel", endPointer);
systemTheme.addEventListener("change", () => {
  if (state.theme === "system") render();
});
let resizeFrame;
observer = new ResizeObserver(() => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(placeWindows);
});
loadPreferences();
render();
try {
  const raw = localStorage.getItem(layoutKey);
  if (raw) {
    const restored = restoreLayout(
      JSON.parse(raw),
      seed.agents.map((a) => a.id),
      area(),
      tokens.window,
    );
    state.windows = restored.windows;
    state.activeId = restored.activeId;
  } else {
    state.windows = [createWindow("lead", 0, area(), tokens.window)];
    state.activeId = state.windows[0].id;
  }
} catch {
  state.storageError = "dataError";
  state.windows = [createWindow("lead", 0, area(), tokens.window)];
  state.activeId = state.windows[0].id;
}
render();
let lastNarrow = window.innerWidth < tokens.breakpoints.mobile;
window.addEventListener("resize", () => {
  const narrow = window.innerWidth < tokens.breakpoints.mobile;
  if (narrow !== lastNarrow) {
    lastNarrow = narrow;
    render();
  } else placeWindows();
});
