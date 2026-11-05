import { diagramLimits } from "../../shared/diagrams";
const ns = "http://www.w3.org/2000/svg";
const tags = new Set([
  "svg",
  "g",
  "defs",
  "marker",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "title",
  "desc",
  "clipPath",
]);
const attrs = new Set([
  "id",
  "class",
  "viewBox",
  "preserveAspectRatio",
  "x",
  "y",
  "x1",
  "x2",
  "y1",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "width",
  "height",
  "d",
  "points",
  "transform",
  "markerWidth",
  "markerHeight",
  "markerUnits",
  "orient",
  "refX",
  "refY",
  "text-anchor",
  "dominant-baseline",
  "alignment-baseline",
  "dx",
  "dy",
  "lengthAdjust",
  "textLength",
  "clipPathUnits",
]);
const presentation = new Set([
  "fill",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "fill-opacity",
  "stroke-opacity",
  "opacity",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
]);
const trustedStyle = `text,tspan{fill:#ececee;font-family:Segoe UI,Arial,sans-serif;font-size:14px}.node .label text{text-anchor:middle}.node rect,.node circle,.node ellipse,.node polygon,.classGroup rect,.statediagram-state rect,.entityBox{fill:#252529;stroke:#a0a0ab}.cluster rect{fill:#202022;stroke:#777780}.edgePath path,.flowchart-link,.transition,.messageLine0,.messageLine1,.relation{stroke:#a0a0ab;fill:none}.actor,.labelBox{fill:#252529;stroke:#a0a0ab}.actor-line{stroke:#a0a0ab}.note{fill:#3a302a;stroke:#fa8c69}.divider{stroke:#777780}marker path,marker polygon{fill:#a0a0ab;stroke:#a0a0ab}`;

// Rebuild an allowlisted SVG tree. The displayed output is used only as an
// image Blob, never as raw SVG markup in the React UI.
export function sanitizedDiagram(svg: string): {
  svg: string;
  width: number;
  height: number;
} {
  if (
    svg.length > diagramLimits.svgBytes ||
    new TextEncoder().encode(svg).length > diagramLimits.svgBytes ||
    /<!DOCTYPE|<!ENTITY/i.test(svg)
  )
    throw Error("Kết quả sơ đồ vượt giới hạn.");
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = parsed.documentElement;
  if (
    root.localName !== "svg" ||
    root.namespaceURI !== ns ||
    parsed.querySelector("parsererror")
  )
    throw Error("Không đọc được sơ đồ.");
  const box = (root.getAttribute("viewBox") ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    box.length !== 4 ||
    box.some((n) => !Number.isFinite(n)) ||
    box[2] <= 0 ||
    box[3] <= 0 ||
    box[2] > diagramLimits.edge ||
    box[3] > diagramLimits.edge ||
    box[2] * box[3] > diagramLimits.pixels
  )
    throw Error("Kích thước sơ đồ vượt giới hạn.");
  const output = document.implementation.createDocument(ns, "svg", null);
  const safeRoot = output.documentElement;
  const ids = new Set<string>();
  let count = 0;
  function copy(source: Element, target: Element, depth = 0) {
    if (depth > 40) throw Error("Sơ đồ có quá nhiều lớp lồng nhau.");
    if (++count > diagramLimits.elements)
      throw Error("Sơ đồ có quá nhiều thành phần.");
    for (const attribute of source.attributes) {
      const { name, value } = attribute;
      if (attribute.namespaceURI || value.length > 100000) continue;
      if (name === "id" && /^[a-zA-Z_][\w.-]{0,180}$/.test(value)) {
        target.setAttribute(name, value);
        ids.add(value);
      } else if (
        attrs.has(name) &&
        name !== "id" &&
        !/[<>\\]|(?:url|javascript|data|https?|file):/i.test(value)
      )
        target.setAttribute(name, value);
      else if (
        presentation.has(name) &&
        /^(?:none|currentColor|transparent|#[a-f0-9]{3,8}|[\d.,%\s-]+|normal|bold|italic|start|middle|end|round|butt|square|miter|bevel)$/i.test(
          value,
        )
      )
        target.setAttribute(name, value);
      else if (
        ["marker-start", "marker-mid", "marker-end", "clip-path"].includes(
          name,
        ) &&
        /^url\(#[a-zA-Z_][\w.-]{0,180}\)$/.test(value)
      )
        target.setAttribute(name, value);
    }
    for (const child of source.childNodes) {
      if (
        child.nodeType === Node.TEXT_NODE &&
        ["text", "tspan", "title", "desc"].includes(source.localName)
      )
        target.appendChild(output.createTextNode(child.textContent ?? ""));
      else if (child.nodeType === Node.ELEMENT_NODE) {
        const element = child as Element;
        if (element.namespaceURI !== ns || !tags.has(element.localName))
          continue;
        const next = output.createElementNS(ns, element.localName);
        copy(element, next, depth + 1);
        target.appendChild(next);
      }
    }
  }
  copy(root, safeRoot);
  for (const element of safeRoot.querySelectorAll("*"))
    for (const name of [
      "marker-start",
      "marker-mid",
      "marker-end",
      "clip-path",
    ]) {
      const ref = element.getAttribute(name);
      if (ref && !ids.has(ref.slice(5, -1))) element.removeAttribute(name);
    }
  safeRoot.setAttribute("xmlns", ns);
  safeRoot.setAttribute("width", String(Math.ceil(box[2])));
  safeRoot.setAttribute("height", String(Math.ceil(box[3])));
  const style = output.createElementNS(ns, "style");
  style.textContent = trustedStyle;
  safeRoot.prepend(style);
  return {
    svg: new XMLSerializer().serializeToString(safeRoot),
    width: Math.ceil(box[2]),
    height: Math.ceil(box[3]),
  };
}
