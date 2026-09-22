import { useEffect, useRef, useState, type ReactNode } from "react";
import { ESCAPE } from "../keys";
import "./chrome.css";
import type { Pressed } from "./layerState";

function itemsOf(root: HTMLElement | null): HTMLElement[] {
  return [...(root?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
}

/**
 * A drop-down: the label opens a panel that closes on Esc, on a click outside, or on `close`.
 * A `compact` menu shows only its chevron, and an `up` menu opens above its label.
 */
export function Menu({
  label,
  title,
  disabled,
  align = "left",
  compact = false,
  up = false,
  children,
}: {
  label: string;
  title?: string;
  disabled?: boolean;
  align?: "left" | "right";
  compact?: boolean;
  up?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const caret = up ? "▴" : "▾";
  const ref = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    itemsOf(pop.current)[0]?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ESCAPE) return;
      e.stopPropagation();
      // A flyout inside the menu registers its listener later, so it claims the press by
      // preventing it; the menu decides once every listener has run.
      queueMicrotask(() => {
        if (!e.defaultPrevented) setOpen(false);
      });
    };
    window.addEventListener("pointerdown", onPointerDown, { capture: true });
    window.addEventListener("keydown", onKey, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, { capture: true });
      window.removeEventListener("keydown", onKey, { capture: true });
    };
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = itemsOf(pop.current);
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (index: number) => {
      e.preventDefault();
      items[(index + items.length) % items.length].focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at <= 0 ? items.length - 1 : at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
  };

  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className={compact ? "menu-label compact" : "menu-label"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={compact ? label : undefined}
        disabled={disabled}
        title={title ?? (compact ? label : undefined)}
        onClick={() => setOpen(!open)}
      >
        {compact ? caret : `${label} ${caret}`}
      </button>
      {open && (
        <div
          className={`menu-pop ${align}${up ? " up" : ""}`}
          role="menu"
          aria-label={label}
          ref={pop}
          onKeyDown={onKeyDown}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** One command in a `Menu`, with its shortcut on the right. */
export function MenuItem({
  label,
  shortcut,
  disabled,
  title,
  onClick,
}: {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="menu-item"
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      <span>{label}</span>
      {shortcut && <kbd>{shortcut}</kbd>}
    </button>
  );
}

/** What the eye shows of what its row names: all of it, some of it, or none. */
const EYE: Record<Pressed, string> = { true: "◉", mixed: "◐", false: "○" };

/** A menu row that switches what it names, with the eye saying how much of it is on. */
export function EyeRow({
  pressed,
  className = "menu-item",
  disabled,
  title,
  onClick,
  children,
}: {
  pressed: Pressed | boolean;
  className?: string;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const state: Pressed = pressed === true ? "true" : pressed === false ? "false" : pressed;
  return (
    <button
      type="button"
      role="menuitem"
      className={className}
      aria-pressed={state}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      <span className="eye">{EYE[state]}</span>
      {children}
    </button>
  );
}
