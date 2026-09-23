import { useState, type CSSProperties, type ReactNode } from "react";
import type { Capabilities } from "../../generated/Capabilities";
import { documentCapabilities, supports } from "../../lib/capabilities";
import { useEditorStore } from "../../store/editorStore";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useInspectorStore } from "../../store/inspectorStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import {
  SECTION_SOURCES,
  UNFOLDED_SECTIONS,
  groupState,
  splitsBySource,
  type Source,
} from "../../lib/visual/layerGroups";
import { ENTER, ESCAPE, SPACE } from "../keys";
import { Twisty } from "../Twisty";
import { useTextureUrl } from "../useTextureUrl";
import { useOwnerCss } from "./ownerCss";

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

/** The one colour that stands for a country, as the legend and the map labels use it. */
export function Swatch({ owner }: { owner: number | null }) {
  const css = useOwnerCss(owner);
  if (css === null) return null;
  return <span className="swatch" style={{ background: css }} />;
}

export function Chip({
  children,
  kind,
  src,
  warn,
  title,
}: {
  children: ReactNode;
  kind?: boolean;
  /** Tinted like the scripts source, for a value the scripts rather than the file decide. */
  src?: boolean;
  warn?: boolean;
  title?: string;
}) {
  return (
    <span
      className={`chip${kind ? " kind" : ""}${src ? " src" : ""}${warn ? " warn" : ""}`}
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

/**
 * A collapsible section; `count` and `summary` stay visible when it is closed. A section follows
 * the source that fills it, so a group with nothing left drawing folds its sections away too.
 */
export function Section({
  id,
  title,
  count,
  summary,
  startClosed = false,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  summary?: string;
  startClosed?: boolean;
  children: ReactNode;
}) {
  const kind = useFileSessionStore((s) => s.kind);
  const source = SECTION_SOURCES[id];
  const foldable = !UNFOLDED_SECTIONS.has(id) && splitsBySource(kind);
  const folded = useMapChromeStore(
    (s) => foldable && source !== undefined && groupState(s, kind, source) === "off",
  );
  const fallback = startClosed || folded;
  const collapsed = useInspectorStore((s) => s.sections[id] ?? fallback);
  const toggleSection = useInspectorStore((s) => s.toggleSection);
  return (
    <>
      <button
        type="button"
        className="ins-sec"
        aria-expanded={!collapsed}
        onClick={() => toggleSection(id, fallback)}
      >
        <Twisty open={!collapsed} />
        <span className="ins-sec-title">
          {title}
          {count !== undefined && ` · ${count}`}
          {summary && ` · ${summary}`}
        </span>
        {source !== undefined && <SourceChip source={source} />}
      </button>
      {!collapsed && children}
    </>
  );
}

/** A label, a value and, later, the control the schema decides. */
export function PropertyRow({
  label,
  title,
  children,
  mono,
}: {
  label: string;
  title?: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <>
      <span className="k" title={title}>
        {label}
      </span>
      <span className={mono ? "mono" : undefined}>{children}</span>
    </>
  );
}

export function Properties({ children, mono }: { children: ReactNode; mono?: boolean }) {
  return <div className={`ins-kv${mono ? " mono" : ""}`}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="muted ins-empty">{children}</div>;
}

/** What a view the Stage 2 entity work will fill says in the meantime. */
export function Placeholder({ children }: { children: ReactNode }) {
  return <div className="muted ins-placeholder">{children}</div>;
}

/**
 * A row that drills into what it names: the whole row is the target, by click or Enter. A row
 * whose entity the open document cannot answer for is plain text instead.
 */
export function DrillRow({
  className = "ins-prow",
  title,
  requires,
  onOpen,
  onPointerEnter,
  onPointerLeave,
  children,
}: {
  className?: string;
  title?: string;
  requires?: keyof Capabilities;
  onOpen: () => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
  children: ReactNode;
}) {
  const capabilities = useFileSessionStore(documentCapabilities);
  if (!supports(capabilities, requires)) {
    return (
      <div
        className={`${className} static`}
        title={title}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
      >
        {children}
      </div>
    );
  }
  return (
    <div
      className={className}
      role="button"
      tabIndex={0}
      title={title}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key !== ENTER && e.key !== SPACE) return;
        e.preventDefault();
        onOpen();
      }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      {children}
    </div>
  );
}

/** The mark an entity or a row carries once an op has rewritten it. */
export function ChangedBadge({ title = "changed by an edit" }: { title?: string }) {
  return (
    <span className="ins-badge" title={title}>
      ●
    </span>
  );
}

/** A drill that sits inside a value: the arrow says the row opens something. */
export function DrillLink({
  requires,
  title,
  onOpen,
  children,
}: {
  requires?: keyof Capabilities;
  title?: string;
  onOpen: () => void;
  children: ReactNode;
}) {
  const capabilities = useFileSessionStore(documentCapabilities);
  if (!supports(capabilities, requires)) return <span title={title}>{children}</span>;
  return (
    <button type="button" className="link ins-drill" title={title} onClick={onOpen}>
      {children} ›
    </button>
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

export function FocusButton({ name, system }: { name: string; system: number }) {
  const jumpTo = useEditorStore((s) => s.jumpTo);
  return (
    <button
      type="button"
      className="link ins-focus"
      title="Focus the system on the map"
      aria-label={`Focus ${name} on the map`}
      onClick={(e) => {
        e.stopPropagation();
        void jumpTo(system);
      }}
    >
      ⌖
    </button>
  );
}

/** The foot of a list that stops at a limit: what is left, and where the rest is. */
export function MoreButton({
  count,
  where,
  onClick,
}: {
  count: number;
  where?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="link ins-more" onClick={onClick}>
      show {count} more{where === undefined ? "" : ` ${where}`}
    </button>
  );
}

type FieldProps = {
  label: string;
  className?: string;
  id?: string;
  autoFocus?: boolean;
  /** Called once the field is done with: after a commit, and when Escape abandons the edit. */
  onDone?: () => void;
} & (
  | {
      kind: "number";
      value: number;
      decimals?: number;
      step?: number;
      onCommit: (v: number) => void;
    }
  | { kind: "text"; value: string; onCommit: (v: string) => void }
);

function fieldText(props: FieldProps): string {
  if (props.kind === "text") return props.value;
  return props.decimals === undefined ? String(props.value) : props.value.toFixed(props.decimals);
}

/** An editable value: commits on Enter or blur when the text differs from the shown one; Escape restores it. */
export function Field(props: FieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = fieldText(props);
  const commit = () => {
    props.onDone?.();
    if (draft === null) return;
    setDraft(null);
    if (draft === shown) return;
    if (props.kind === "text") {
      props.onCommit(draft);
      return;
    }
    const n = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(n)) props.onCommit(n);
  };
  return (
    <input
      type={props.kind}
      id={props.id}
      step={props.kind === "number" ? (props.step ?? 1) : undefined}
      className={props.className}
      aria-label={props.label}
      autoFocus={props.autoFocus}
      value={draft ?? shown}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === ENTER) e.currentTarget.blur();
        else if (e.key === ESCAPE) {
          setDraft(null);
          props.onDone?.();
        }
      }}
    />
  );
}
