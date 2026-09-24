import { useEffect, useRef, useState, type ReactNode } from "react";
import { SubmenuAim } from "../../../lib/menuAim";

/**
 * An entry of a menu that opens a menu of its own beside it: on hover, a click or the right arrow.
 * It stays open a moment after the pointer leaves, and while the pointer heads for it. A disabled
 * one never opens, and `hint` reads under its label.
 */
export function Submenu({
  label,
  hint,
  disabled,
  title,
  className,
  children,
}: {
  label: string;
  hint?: string;
  disabled?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [aim] = useState(() => new SubmenuAim(setOpen));
  const focusFirst = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  const focusList = () =>
    list.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
  useEffect(() => {
    if (!open || !focusFirst.current) return;
    focusFirst.current = false;
    focusList();
  }, [open]);
  useEffect(() => () => aim.cancel(), [aim]);
  useEffect(() => {
    if (!open) return;
    const onMove = (e: PointerEvent) =>
      aim.move({ x: e.clientX, y: e.clientY }, list.current?.getBoundingClientRect() ?? null);
    document.addEventListener("pointermove", onMove);
    return () => document.removeEventListener("pointermove", onMove);
  }, [open, aim]);

  const classes = ["menu-item", "context-submenu-item", hint && "hinted", className]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className="context-submenu"
      onPointerEnter={() => aim.enter(!disabled)}
      onPointerLeave={(e) => aim.leave({ x: e.clientX, y: e.clientY })}
    >
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        className={classes}
        disabled={disabled}
        title={title}
        onClick={() => {
          aim.cancel();
          setOpen(!open);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" && !disabled) {
            e.preventDefault();
            aim.cancel();
            if (open) {
              focusList();
            } else {
              focusFirst.current = true;
              setOpen(true);
            }
          } else if (e.key === "ArrowLeft") {
            aim.closeNow();
          }
        }}
      >
        <span className="context-submenu-label">
          {label}
          <span className="context-submenu-caret" aria-hidden="true">
            ▸
          </span>
        </span>
        {hint && <span className="muted">{hint}</span>}
      </button>
      {open && (
        <div
          ref={list}
          className="context-menu context-submenu-list"
          role="menu"
          aria-label={label}
        >
          {children}
        </div>
      )}
    </div>
  );
}
