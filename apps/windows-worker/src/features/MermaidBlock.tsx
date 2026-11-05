import { useEffect, useRef, useState } from "react";
import { Copy, LoaderCircle, X } from "lucide-react";
import { diagramSource } from "../../shared/diagrams";

export function MermaidBlock({ source }: { source: string }) {
  const [image, setImage] = useState("");
  const [view, setView] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copy, setCopy] = useState("");
  const [expanded, setExpanded] = useState(false);
  const lifetime = useRef(new AbortController());
  const objectURL = useRef("");
  const dialog = useRef<HTMLDialogElement>(null);
  const rendering = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => {
      controller.abort();
      if (objectURL.current) URL.revokeObjectURL(objectURL.current);
    };
  }, []);
  useEffect(() => {
    if (expanded) dialog.current?.showModal();
  }, [expanded]);
  async function preview() {
    if (image) {
      setView((current) => !current);
      return;
    }
    if (rendering.current) return;
    rendering.current = true;
    const signal = lifetime.current.signal;
    setBusy(true);
    setError("");
    try {
      diagramSource(source);
      const { renderDiagram } = await import("../lib/diagram-renderer");
      const result = await renderDiagram(source, signal);
      if (signal.aborted) return;
      const url = URL.createObjectURL(
        new Blob([result.svg], { type: "image/svg+xml" }),
      );
      if (objectURL.current) URL.revokeObjectURL(objectURL.current);
      objectURL.current = url;
      setImage(url);
      setView(true);
    } catch (reason) {
      if (!signal.aborted)
        setError(
          reason instanceof Error ? reason.message : "Không đọc được sơ đồ.",
        );
    } finally {
      rendering.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="mermaid-block" aria-label="Sơ đồ Mermaid">
      <div className="diagram-toolbar">
        <button
          disabled={busy}
          aria-pressed={view}
          onClick={() => void preview()}
        >
          {busy ? <LoaderCircle size={13} className="spin" /> : null}
          {view ? "Xem mã" : "Xem sơ đồ"}
        </button>
        <button
          aria-label="Sao chép mã Mermaid"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(source);
              setCopy("Đã chép");
            } catch {
              setCopy("Chép lại");
            }
          }}
        >
          <Copy size={13} />
          {copy || "Sao chép"}
        </button>
      </div>
      {error && (
        <p className="diagram-error" role="status">
          {error}
        </p>
      )}
      {view && image ? (
        <button
          className="diagram-image"
          aria-label="Phóng to sơ đồ"
          onClick={() => setExpanded(true)}
        >
          <img
            src={image}
            alt="Sơ đồ Mermaid"
            onError={() => {
              setView(false);
              setImage("");
              URL.revokeObjectURL(objectURL.current);
              objectURL.current = "";
              setError("Không hiển thị được sơ đồ. Mã gốc được giữ bên dưới.");
            }}
          />
        </button>
      ) : (
        <pre>
          <code className="language-mermaid">{source}</code>
        </pre>
      )}
      {expanded && (
        <dialog
          ref={dialog}
          className="diagram-preview"
          aria-label="Sơ đồ phóng to"
          onCancel={() => setExpanded(false)}
        >
          <header>
            <span>Sơ đồ</span>
            <button
              className="icon-button"
              aria-label="Đóng sơ đồ"
              autoFocus
              onClick={() => setExpanded(false)}
            >
              <X size={18} />
            </button>
          </header>
          <div tabIndex={0} role="region" aria-label="Nội dung sơ đồ">
            <img src={image} alt="Sơ đồ Mermaid phóng to" />
          </div>
        </dialog>
      )}
    </section>
  );
}
