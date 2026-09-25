import { useEffect, useRef } from "react";
import type { InitializerView } from "../../generated/InitializerView";
import { useGameDataStore } from "../../store/gameDataStore";
import { RANDOM_KEY, useInitializerBrowserStore } from "../../store/initializerBrowserStore";
import { Icon } from "../parts";
import { entryLabel, RANDOM_LABEL, sourceBadge } from "./rows";

/** The id the listbox names its highlighted row by. */
function rowId(key: string): string {
  return `ib-row-${key}`;
}

function StarGlyph({ entry }: { entry: InitializerView | null }) {
  const starClasses = useGameDataStore((s) => s.starClasses);
  const key = entry?.class;
  const texture = key === null || key === undefined ? undefined : starClasses.get(key)?.texture_key;
  return <Icon className="ib-star" keys={texture ? [texture] : []} glyph="★" />;
}

function Row({
  entry,
  used,
  current,
  active,
  onAssign,
}: {
  entry: InitializerView | null;
  used: number;
  current: boolean;
  active: boolean;
  onAssign: () => void;
}) {
  const names = useGameDataStore((s) => s.names);
  const pinned = useInitializerBrowserStore((s) => s.pinned);
  const defaultKey = useInitializerBrowserStore((s) => s.defaultKey);
  const highlight = useInitializerBrowserStore((s) => s.highlight);
  const togglePin = useInitializerBrowserStore((s) => s.togglePin);
  const key = entry === null ? RANDOM_KEY : entry.name;
  const label = entry === null ? null : entryLabel(entry, names);
  const pin = pinned.includes(key);
  const isDefault = entry === null ? defaultKey === null : entry.name === defaultKey;
  return (
    <div
      id={rowId(key)}
      role="option"
      aria-selected={active}
      className={`ib-row${active ? " active" : ""}`}
      onMouseDown={(e) => {
        e.preventDefault();
        highlight(key);
      }}
      onDoubleClick={onAssign}
    >
      <StarGlyph entry={entry} />
      <span className="ib-names">
        <span className="ib-key mono">{entry === null ? RANDOM_LABEL : entry.name}</span>
        {label !== null && <span className="ib-label">{label}</span>}
      </span>
      <span className="ib-badges">
        {used > 0 && (
          <span className="ib-badge" title={`${used} systems in this document use it`}>
            {used}×
          </span>
        )}
        {entry?.usage != null && <span className="ib-badge kind">{entry.usage}</span>}
        {entry !== null && entry.planet_count > 0 && (
          <span className="ib-badge" title={`${entry.planet_count} bodies`}>
            {entry.planet_count}p
          </span>
        )}
        {entry !== null && (
          <span className="ib-badge file" title={entry.source}>
            {sourceBadge(entry.source)}
          </span>
        )}
      </span>
      {isDefault && <span className="ib-default">default</span>}
      {current && <span className="ib-current">current</span>}
      {entry !== null && (
        <button
          type="button"
          tabIndex={-1}
          className={`link ib-pin${pin ? " on" : ""}`}
          aria-label={pin ? `Unpin ${entry.name}` : `Pin ${entry.name}`}
          title={`${pin ? "Unpin" : "Pin"} (Ctrl+D)`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => togglePin(key)}
        >
          {pin ? "★" : "☆"}
        </button>
      )}
    </div>
  );
}

/** Every initializer the query leaves, the highlighted one kept in view as the keys move. */
export function List({
  keys,
  byKey,
  uses,
  current,
  more,
  onAssign,
}: {
  keys: readonly string[];
  byKey: ReadonlyMap<string, InitializerView>;
  uses: ReadonlyMap<string, number>;
  current: ReadonlySet<string>;
  more: number;
  onAssign: () => void;
}) {
  const highlighted = useInitializerBrowserStore((s) => s.highlighted);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [highlighted, keys]);

  return (
    <div
      className="ib-list"
      ref={ref}
      role="listbox"
      aria-label="Initializers"
      aria-activedescendant={highlighted === null ? undefined : rowId(highlighted)}
      tabIndex={0}
    >
      {keys.length === 0 && <div className="muted ib-empty">Nothing matches that search.</div>}
      {keys.map((key) => (
        <Row
          key={key}
          entry={byKey.get(key) ?? null}
          used={uses.get(key === RANDOM_KEY ? "" : key) ?? 0}
          current={current.has(key)}
          active={key === highlighted}
          onAssign={onAssign}
        />
      ))}
      {more > 0 && <div className="muted ib-empty">{more} more — refine the search.</div>}
    </div>
  );
}
