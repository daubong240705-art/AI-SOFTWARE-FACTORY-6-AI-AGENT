import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { Check, ChevronDown } from "lucide-react";

type Props = Pick<
  ComponentPropsWithoutRef<"button">,
  | "id"
  | "title"
  | "disabled"
  | "className"
  | "aria-label"
  | "aria-labelledby"
  | "aria-describedby"
> & {
  children: ReactNode;
  name?: string;
  required?: boolean;
  value: string | number;
  onValueChange: (value: string) => void;
};
function text(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? text(child.props.children)
        : String(child),
    )
    .join("");
}

// Controlled single selection. The option markup remains declarative at call sites;
// both the trigger and menu are app-rendered, with no native select/popup.
export function Select({
  value,
  children,
  onValueChange,
  disabled,
  className = "",
  title,
  id,
  name,
  required,
  ...rest
}: Props) {
  const options = Children.toArray(children).flatMap((child) => {
    if (
      !isValidElement<{
        value?: string | number;
        disabled?: boolean;
        children?: ReactNode;
      }>(child)
    )
      return [];
    const label = text(child.props.children);
    return [
      {
        value: String(child.props.value ?? label),
        label,
        disabled: !!child.props.disabled,
      },
    ];
  });
  const selected = options.findIndex(
    (option) => option.value === String(value),
  );
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLSpanElement>(null);
  const wrapper = useRef<HTMLSpanElement>(null);
  const search = useRef({ value: "", at: 0 });
  const menuId = useId();
  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    onValueChange(option.value);
    setOpen(false);
    trigger.current?.focus();
  }
  function move(direction: number, from = active) {
    for (let step = 1; step <= options.length; step++) {
      const index = (from + direction * step + options.length) % options.length;
      if (!options[index].disabled) {
        setActive(index);
        return;
      }
    }
  }
  function show(index = selected) {
    if (disabled || !options.some((option) => !option.disabled)) return;
    setActive(
      index >= 0 && !options[index]?.disabled
        ? index
        : options.findIndex((option) => !option.disabled),
    );
    setOpen(true);
  }
  useEffect(() => {
    if (!open || !menu.current || !trigger.current) return;
    if (disabled) {
      setOpen(false);
      return;
    }
    const popup = menu.current;
    // Popover top layer avoids clipping by board scroll areas and works inside
    // native modal dialogs without portaling outside their focus boundary.
    popup.showPopover();
    const position = () => {
      if (!trigger.current) return;
      const rect = trigger.current.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 220), window.innerWidth - 16);
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const up = below < Math.min(popup.scrollHeight, 280) && above > below;
      popup.style.width = `${width}px`;
      popup.style.maxHeight = `${Math.max(0, Math.min(320, up ? above : below))}px`;
      popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
      popup.style.top = `${up ? rect.top - popup.getBoundingClientRect().height - 4 : rect.bottom + 4}px`;
    };
    position();
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
      if (popup.matches(":popover-open")) popup.hidePopover();
    };
  }, [open, disabled]);
  useEffect(() => {
    if (open)
      menu.current
        ?.querySelector(`[data-index="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, active]);
  return (
    <span className={`ui-select ${className}`} ref={wrapper}>
      {name && (
        <input type="hidden" name={name} value={value} disabled={disabled} />
      )}
      <button
        {...rest}
        id={id}
        ref={trigger}
        type="button"
        className="ui-select-trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-activedescendant={open ? `${menuId}-${active}` : undefined}
        aria-required={required || undefined}
        disabled={disabled}
        title={title ?? options[selected]?.label}
        onClick={() => (open ? setOpen(false) : show())}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          // A closed dropdown must leave Escape available to the parent dialog.
          if (event.key === "Escape" && !open) return;
          if (
            [
              "ArrowDown",
              "ArrowUp",
              "Home",
              "End",
              "Enter",
              " ",
              "Escape",
            ].includes(event.key)
          ) {
            event.preventDefault();
            event.stopPropagation();
            if (event.key === "Escape") setOpen(false);
            else if (event.key === "Enter" || event.key === " ")
              open ? choose(active) : show();
            else if (event.key === "Home") {
              if (!open) show(0);
              else move(1, -1);
            } else if (event.key === "End") {
              if (!open) show(options.length - 1);
              else move(-1, options.length);
            } else if (!open) show();
            else move(event.key === "ArrowDown" ? 1 : -1);
          } else if (event.key === "Tab") setOpen(false);
          else if (
            event.key.length === 1 &&
            !event.ctrlKey &&
            !event.altKey &&
            !event.metaKey
          ) {
            event.preventDefault();
            const now = Date.now();
            const prefix =
              (now - search.current.at < 700 ? search.current.value : "") +
              event.key.toLocaleLowerCase();
            search.current = { value: prefix, at: now };
            const index = options.findIndex(
              (option) =>
                !option.disabled &&
                option.label.toLocaleLowerCase().startsWith(prefix),
            );
            if (index >= 0) {
              if (!open) show(index);
              else setActive(index);
            }
          }
        }}
      >
        <span className="ui-select-value">
          {options[selected]?.label ?? "Chọn"}
        </span>
        <ChevronDown
          className="ui-select-chevron"
          size={14}
          aria-hidden="true"
        />
      </button>
      {open && (
        <span
          ref={menu}
          id={menuId}
          popover="manual"
          className="ui-select-menu"
          role="listbox"
          aria-label={
            rest["aria-label"] ?? options[selected]?.label ?? "Lựa chọn"
          }
          onPointerDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {options.map((option, index) => (
            <span
              key={option.value}
              id={`${menuId}-${index}`}
              role="option"
              aria-selected={index === selected}
              aria-disabled={option.disabled || undefined}
              data-index={index}
              data-value={option.value}
              className={`ui-select-option ${index === active ? "active" : ""}`}
              onPointerMove={() => {
                if (!option.disabled) setActive(index);
              }}
              onClick={() => choose(index)}
            >
              <span>{option.label}</span>
              {index === selected && <Check size={14} aria-hidden="true" />}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
