// Pure fixture geometry; no conversation, network or runtime state.
export const windowModes = ["floating", "minimized", "maximized"];
export function clampBounds(bounds, area, config) {
  const width = Math.max(0, Number.isFinite(area.width) ? area.width : 0);
  const height = Math.max(0, Number.isFinite(area.height) ? area.height : 0);
  const safe = (value, fallback) => (Number.isFinite(value) ? value : fallback);
  const w = Math.min(
    width,
    Math.max(config.minWidth, safe(bounds.width, config.defaultWidth)),
  );
  const h = Math.min(
    height,
    Math.max(config.minHeight, safe(bounds.height, config.defaultHeight)),
  );
  return {
    x: Math.min(Math.max(0, safe(bounds.x, 0)), Math.max(0, width - w)),
    y: Math.min(Math.max(0, safe(bounds.y, 0)), Math.max(0, height - h)),
    width: w,
    height: h,
  };
}
export function createWindow(agentId, index, area, config) {
  return {
    id: `sample-${agentId}`,
    agentId,
    mode: "floating",
    bounds: clampBounds(
      {
        x:
          area.width -
          config.defaultWidth -
          config.inset -
          index * config.cascade,
        y: config.inset + index * config.cascade,
        width: config.defaultWidth,
        height: config.defaultHeight,
      },
      area,
      config,
    ),
  };
}
export function displayBounds(item, area, config, narrow = false) {
  return item.mode === "maximized" || narrow
    ? {
        x: 0,
        y: 0,
        width: Math.max(0, area.width),
        height: Math.max(0, area.height),
      }
    : clampBounds(item.bounds, area, config);
}
export function restoreLayout(raw, allowed, area, config) {
  if (
    !raw ||
    raw.schemaVersion !== 1 ||
    !Array.isArray(raw.windows) ||
    raw.windows.length > config.maxOpen
  )
    throw Error("Invalid fixture layout");
  const seen = new Set();
  const windows = raw.windows.map((item) => {
    if (
      !item ||
      !allowed.includes(item.agentId) ||
      seen.has(item.agentId) ||
      !windowModes.includes(item.mode)
    )
      throw Error("Invalid fixture window");
    if (
      !item.bounds ||
      !["x", "y", "width", "height"].every((key) =>
        Number.isFinite(item.bounds[key]),
      )
    )
      throw Error("Invalid fixture bounds");
    seen.add(item.agentId);
    return {
      id: `sample-${item.agentId}`,
      agentId: item.agentId,
      mode: item.mode,
      bounds: clampBounds(item.bounds, area, config),
    };
  });
  const ids = windows.map((item) => item.id);
  const visible = windows
    .filter((item) => item.mode !== "minimized")
    .map((item) => item.id);
  return {
    schemaVersion: 1,
    windows,
    activeId: visible.includes(raw.activeId)
      ? raw.activeId
      : (visible.at(-1) ?? null),
  };
}
export function serializeLayout(windows, activeId) {
  return {
    schemaVersion: 1,
    activeId,
    windows: windows.map(({ id, agentId, mode, bounds }) => ({
      id,
      agentId,
      mode,
      bounds: { ...bounds },
    })),
  };
}
