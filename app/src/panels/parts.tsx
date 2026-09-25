import type { CSSProperties, ReactNode } from "react";
import { splitsBySource, type Source } from "../lib/visual/layerGroups";
import { useFileSessionStore } from "../store/fileSessionStore";
import { useTextureUrl } from "./useTextureUrl";
import "./panels.css";

/** A sprite from the game with the map's own fallback when its art is unavailable. */
export function Icon({
  keys,
  glyph,
  className,
  style,
  title,
}: {
  keys: readonly string[];
  glyph?: string;
  className?: string;
  style?: CSSProperties;
  title?: string;
}) {
  const url = useTextureUrl(keys);
  return (
    <span className={className} style={url ? undefined : style} title={title}>
      {url ? <img src={url} alt="" /> : glyph}
    </span>
  );
}

export function Chip({
  children,
  kind,
  src,
  warn,
  added,
  title,
}: {
  children: ReactNode;
  kind?: boolean;
  /** Green, for a system added this session. */
  added?: boolean;
  /** Tinted like the scripts source, for a value the scripts rather than the file decide. */
  src?: boolean;
  warn?: boolean;
  title?: string;
}) {
  return (
    <span
      className={`chip${kind ? " kind" : ""}${src ? " src" : ""}${warn ? " warn" : ""}${added ? " added" : ""}`}
      title={title}
    >
      {children}
    </span>
  );
}

export type { Source };

/** The chip class each source wears, the hues the layer bar frames its groups in. */
const CHIP_CLASS: Record<Source, string> = {
  scenario: "chip",
  initializers: "chip init",
  scripts: "chip src",
};

/**
 * What a section or a value came from. A save has one source, so it carries no chip; a scenario
 * marks what its own text says apart from what the initializers place and the scripts add.
 */
export function SourceChip({ source, title }: { source: Source; title?: string }) {
  const split = useFileSessionStore((s) => splitsBySource(s.kind));
  if (!split) return null;
  return (
    <span className={CHIP_CLASS[source]} title={title}>
      {source}
    </span>
  );
}

/** Above this many rows a list carries a filter of its own. */
export const FILTER_MIN = 20;

/** The filter a long list grows, in the shape the Layers menu's legend already uses. */
export function FilterField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      className="filter-input"
      type="search"
      aria-label={label}
      placeholder={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
