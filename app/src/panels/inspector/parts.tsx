import type { ReactNode } from "react";
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
} from "../../lib/visual/layerGroups";
import { ENTER, SPACE } from "../keys";
import { LockGlyph } from "../Glyph";
import { Twisty } from "../Twisty";
import { SourceChip } from "../parts";
import { useOwnerCss } from "./ownerCss";

/** The one colour that stands for a country, as the legend and the map labels use it. */
export function Swatch({ owner }: { owner: number | null }) {
  const css = useOwnerCss(owner);
  if (css === null) return null;
  return <span className="swatch" style={{ background: css }} />;
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

/** What a page the open document cannot read says instead of its view. */
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

/** A property row whose value opens that entity's own page. */
export function LinkRow({
  label,
  requires,
  title,
  onOpen,
  children,
}: {
  label: string;
  requires?: keyof Capabilities;
  title?: string;
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <PropertyRow label={label}>
      <DrillLink requires={requires} title={title} onOpen={onOpen}>
        {children}
      </DrillLink>
    </PropertyRow>
  );
}

/**
 * A property row the user would expect to edit but cannot yet: its value, and a muted lock that
 * says so. Only for such values; the rest of a page's information carries no mark.
 */
export function LockedRow({
  label,
  reason,
  children,
}: {
  label: string;
  /** What the lock says on hover. */
  reason: string;
  children: ReactNode;
}) {
  return (
    <PropertyRow label={label}>
      {children}
      <span className="ins-locked" title={reason}>
        <LockGlyph />
        can&apos;t edit yet
      </span>
    </PropertyRow>
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
