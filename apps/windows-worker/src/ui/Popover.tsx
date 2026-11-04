import { useEffect, useId, useRef, useState, type ReactNode } from "react";

// App-rendered, non-modal disclosure in the top layer. Buttons keep normal Tab
// navigation; Escape/outside click close it and return keyboard focus safely.
export function Popover({
  label,
  icon,
  children,
  className = "",
}: {
  label: string;
  icon: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open || !popup.current || !trigger.current) return;
    const panel = popup.current;
    panel.showPopover();
    const position = () => {
      const rect = trigger.current!.getBoundingClientRect();
      panel.style.width = `${Math.min(320, window.innerWidth - 24)}px`;
      panel.style.maxHeight = `${Math.max(80, window.innerHeight - 24)}px`;
      const size = panel.getBoundingClientRect();
      panel.style.left = `${Math.max(12, Math.min(rect.right - size.width, window.innerWidth - size.width - 12))}px`;
      panel.style.top = `${Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - size.height - 12))}px`;
    };
    position();
    panel.querySelector<HTMLElement>("button, input, [tabindex='0']")?.focus();
    const outside = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      if (panel.matches(":popover-open")) panel.hidePopover();
    };
  }, [open]);
  return (
    <div
      ref={wrapper}
      className={`ui-popover ${className}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="icon-button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
      >
        {icon}
      </button>
      {open && (
        <div
          ref={popup}
          id={id}
          popover="manual"
          role="dialog"
          aria-label={label}
          className="ui-popover-panel"
          onClick={(event) => {
            if ((event.target as Element).closest("button")) {
              setOpen(false);
              trigger.current?.focus();
            }
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
