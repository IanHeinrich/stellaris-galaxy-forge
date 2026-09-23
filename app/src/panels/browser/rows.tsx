import type { ReactNode } from "react";
import { Twisty } from "../Twisty";
import { useTextureUrl } from "../useTextureUrl";
import "./browser.css";

export function Eye({ on, label, onToggle }: { on: boolean; label: string; onToggle(): void }) {
  return (
    <button
      type="button"
      className="browser-eye"
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      {on ? "◉" : "○"}
    </button>
  );
}

/** A collapsible section: eye, name, count when collapsed, a note and its rows under it. */
export function Group({
  label,
  title,
  count,
  open,
  error = false,
  sub = false,
  lead,
  actions,
  note,
  onToggle,
  children,
}: {
  label: string;
  title?: string;
  count: number;
  open: boolean;
  error?: boolean;
  sub?: boolean;
  lead?: ReactNode;
  /** Hover actions after the count, for the section as a whole. */
  actions?: ReactNode;
  /** What the whole section means and what to do about it, shown while it is open. */
  note?: ReactNode;
  onToggle(): void;
  children: ReactNode;
}) {
  return (
    <div className={sub ? "browser-group browser-sub-group" : "browser-group"}>
      <div className={error ? "browser-head error" : "browser-head"} title={title}>
        <button
          type="button"
          className="browser-twisty"
          aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
          aria-expanded={open}
          onClick={onToggle}
        >
          <Twisty open={open} />
        </button>
        {lead}
        <button type="button" className="browser-title" onClick={onToggle}>
          {label}
        </button>
        <span className="browser-count">{count}</span>
        {actions !== undefined && <span className="browser-actions">{actions}</span>}
      </div>
      {open && note !== undefined && <div className="browser-group-note">{note}</div>}
      {open && children}
    </div>
  );
}

/** The row anatomy: leading marks, a name that goes there, a subline, a count and hover actions. */
export function Row({
  lead,
  name,
  title,
  subline,
  count,
  stacked = false,
  onName,
  actions,
}: {
  lead?: ReactNode;
  name: string;
  title?: string;
  subline?: string | null;
  count?: number;
  /** The subline takes a line of its own, so neither it nor the name is cut short. */
  stacked?: boolean;
  onName?: (() => void) | null;
  actions?: ReactNode;
}) {
  return (
    <div className={stacked ? "browser-row stacked" : "browser-row"}>
      {lead}
      <button
        type="button"
        className="browser-name"
        title={title}
        disabled={!onName}
        onClick={() => onName?.()}
      >
        {name}
      </button>
      {subline && <span className="browser-sub">{subline}</span>}
      {count !== undefined && <span className="browser-count">{count}</span>}
      <span className="browser-actions">{actions}</span>
    </div>
  );
}

export function Action({
  glyph,
  label,
  onClick,
}: {
  glyph: string;
  label: string;
  onClick(): void;
}) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}>
      {glyph}
    </button>
  );
}

/** The empire's emblem once game data has drawn it, its map colour until then. */
export function Emblem({ flagKey, color }: { flagKey: string | null; color: string }) {
  const url = useTextureUrl(flagKey === null ? [] : [flagKey]);
  if (url === undefined) return <span className="browser-swatch" style={{ background: color }} />;
  return <img className="browser-emblem" src={url} alt="" />;
}
