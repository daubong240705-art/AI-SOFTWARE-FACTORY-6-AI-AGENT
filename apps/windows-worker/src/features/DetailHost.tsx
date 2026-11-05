import { useEffect, useRef, type ReactNode } from "react";

// Stable parent for the single ChatHost. Switching detail tabs never reparents
// the composer. Sibling surfaces become inert only while a detail is open.
export function DetailHost({
  active,
  label,
  onClose,
  children,
  error,
}: {
  active: boolean;
  label: string;
  onClose: () => void;
  children: ReactNode;
  error?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!active || !root.current) return;
    const element = root.current;
    const previous = document.activeElement as HTMLElement | null;
    const siblings: { element: HTMLElement; inert: boolean }[] = [];
    let branch: HTMLElement = element;
    while (branch.parentElement && branch.parentElement !== document.body) {
      for (const sibling of branch.parentElement.children) {
        if (sibling !== branch && sibling instanceof HTMLElement) {
          siblings.push({ element: sibling, inert: sibling.inert });
          sibling.inert = true;
        }
      }
      branch = branch.parentElement;
    }
    const controls = () =>
      [
        ...element.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),summary,a[href],select:not(:disabled),[tabindex="0"]',
        ),
      ].filter(
        (el) =>
          el.getClientRects().length &&
          !el.closest("[hidden]") &&
          !el.closest(".work-document[hidden]"),
      );
    const frame = requestAnimationFrame(() =>
      (controls()[0] ?? element).focus(),
    );
    const key = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !element.querySelector(":popover-open,dialog[open]")
      ) {
        event.preventDefault();
        close.current();
      }
      if (event.key === "Tab") {
        const list = controls(),
          first = list[0],
          last = list.at(-1);
        if (!first) {
          event.preventDefault();
          element.focus();
        } else if (
          event.shiftKey &&
          (document.activeElement === first ||
            !element.contains(document.activeElement))
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !element.contains(document.activeElement))
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    element.addEventListener("keydown", key);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("keydown", key);
      for (const item of siblings) item.element.inert = item.inert;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [active]);
  return (
    <div
      ref={root}
      className={`workspace-detail-host ${active ? "detail-open" : ""}`}
      role={active ? "dialog" : undefined}
      aria-modal={active || undefined}
      aria-label={active ? label : undefined}
      tabIndex={active ? -1 : undefined}
    >
      {active && error && (
        <p className="notice error detail-operation-error" role="alert">
          {error}
        </p>
      )}
      {children}
    </div>
  );
}
