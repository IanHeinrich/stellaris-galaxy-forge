import { useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { placeBeside, SubmenuAim, type Placed } from "../../../lib/menuAim";
import { MenuSide } from "./menuState";

/** How far above its entry a submenu's list starts, so its first item lines up with the entry. */
const LIST_INSET_PX = 7;
/** How far a submenu's list reaches back over its entry, so the pointer never crosses a gap. */
const OVERLAP_PX = 2;

/**
 * An entry of a menu that opens a menu of its own beside it: on hover, a click or the right arrow.
 * It stays open a moment after the pointer leaves, and while the pointer heads for it. A disabled
 * one never opens, and `hint` reads under its label. The list is fixed to the window, so it
 * escapes a scrolling list it sits in. It opens on the side its own menu did, and on the other
 * where that side has no room.
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
  const entry = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const side = useContext(MenuSide);
  const [place, setPlace] = useState<Placed | null>(null);
  const focusList = () =>
    list.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
  useEffect(() => {
    if (!open || !focusFirst.current) return;
    focusFirst.current = false;
    focusList();
  }, [open]);
  useEffect(() => () => aim.cancel(), [aim]);
  // Rows landing change the list's size, and scrolling the list the entry sits in moves the entry.
  useLayoutEffect(() => {
    const from = entry.current;
    const menu = list.current;
    if (!open || !from || !menu) return undefined;
    const place = () => {
      const at = from.getBoundingClientRect();
      const next = placeBeside(
        at,
        at.top - LIST_INSET_PX,
        { width: menu.offsetWidth, height: menu.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        OVERLAP_PX,
        side,
      );
      setPlace((was) =>
        was?.left === next.left && was.top === next.top && was.side === next.side ? was : next,
      );
    };
    place();
    const resized = new ResizeObserver(place);
    resized.observe(menu);
    const scroller = from.closest(".context-submenu-list");
    scroller?.addEventListener("scroll", place);
    window.addEventListener("resize", place);
    return () => {
      resized.disconnect();
      scroller?.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
    };
  }, [open, side]);
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
      ref={entry}
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
          style={place ? { position: "fixed", left: place.left, top: place.top } : undefined}
        >
          <MenuSide value={place?.side ?? side}>{children}</MenuSide>
        </div>
      )}
    </div>
  );
}
