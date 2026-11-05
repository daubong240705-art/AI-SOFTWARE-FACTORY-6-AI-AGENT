import { diagramSource } from "../../shared/diagrams";
import { sanitizedDiagram } from "./diagram-svg";
import engineURL from "@mermaid-js/tiny/dist/mermaid.tiny.js?url";
type Result = ReturnType<typeof sanitizedDiagram>;
const cache = new Map<string, Result>();
let queue = Promise.resolve(),
  waiting = 0;
type Engine = {
  initialize(config: Record<string, unknown>): void;
  render(
    id: string,
    source: string,
    container: HTMLElement,
  ): Promise<{ svg: string }>;
};
let library: Promise<Engine> | undefined;
function engine() {
  return (library ??= new Promise<Engine>((resolve, reject) => {
    // Tiny is an upstream classic browser script, not an ESM module. Vite
    // copies this pinned browser distribution as a local asset.
    const script = document.createElement("script");
    script.src = engineURL;
    const timer = setTimeout(() => {
      script.remove();
      reject(Error("Quá thời gian nạp Mermaid."));
    }, 15000);
    script.onload = () => {
      clearTimeout(timer);
      const mermaid = (globalThis as typeof globalThis & { mermaid?: Engine })
        .mermaid;
      if (mermaid) resolve(mermaid);
      else reject(Error("Không nạp được Mermaid."));
    };
    script.onerror = () => {
      clearTimeout(timer);
      script.remove();
      reject(Error("Không nạp được Mermaid."));
    };
    document.head.appendChild(script);
  })
    .then((mermaid) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        htmlLabels: false,
        suppressErrorRendering: true,
        maxTextSize: 8000,
        maxEdges: 80,
        theme: "dark",
        fontFamily: "Segoe UI, Arial, sans-serif",
        themeVariables: {
          fontFamily: "Segoe UI, Arial, sans-serif",
          fontSize: "14px",
        },
        flowchart: { htmlLabels: false, useMaxWidth: false },
        sequence: { useMaxWidth: false },
      });
      return mermaid;
    })
    .catch((error) => {
      library = undefined;
      throw error;
    }));
}
export async function renderDiagram(
  input: string,
  signal: AbortSignal,
): Promise<Result> {
  const source = diagramSource(input);
  if (signal.aborted) throw Error("Đã đóng sơ đồ.");
  const saved = cache.get(source);
  if (saved) return saved;
  if (waiting >= 4) throw Error("Đang xử lý sơ đồ khác. Thử lại sau.");
  waiting++;
  let release!: () => void;
  const previous = queue;
  queue = new Promise<void>((resolve) => {
    release = resolve;
  });
  let container: HTMLDivElement | undefined;
  try {
    await previous;
    if (signal.aborted) throw Error("Đã đóng sơ đồ.");
    const mermaid = await engine();
    if (signal.aborted) throw Error("Đã đóng sơ đồ.");
    container = document.createElement("div");
    container.className = "diagram-staging";
    container.setAttribute("aria-hidden", "true");
    document.body.appendChild(container);
    const id = "asfDiagram" + crypto.randomUUID().replaceAll("-", "");
    const result = await mermaid.render(id, source, container);
    const safe = sanitizedDiagram(result.svg);
    if (!signal.aborted) {
      cache.set(source, safe);
      while (
        cache.size > 12 ||
        [...cache.values()].reduce((n, value) => n + value.svg.length * 2, 0) >
          2000000
      )
        cache.delete(cache.keys().next().value!);
    }
    return safe;
  } catch {
    throw Error(
      "Chưa dựng được sơ đồ. Xem mã để kiểm tra cú pháp hoặc chia nhỏ nội dung.",
    );
  } finally {
    container?.remove();
    waiting--;
    release();
  }
}
