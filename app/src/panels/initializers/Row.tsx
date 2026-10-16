import type { InitializerView } from "../../generated/InitializerView";
import { useGameDataStore } from "../../store/gameDataStore";
import { RANDOM_KEY, useInitializerBrowserStore } from "../../store/initializerBrowserStore";
import { Icon } from "../parts";
import { entryLabel, RANDOM_LABEL, sourceBadge } from "./rows";

function StarGlyph({ entry }: { entry: InitializerView | null }) {
  const starClasses = useGameDataStore((s) => s.starClasses);
  const key = entry?.class;
  const texture = key === null || key === undefined ? undefined : starClasses.get(key)?.texture_key;
  return <Icon className="ib-star" keys={texture ? [texture] : []} glyph="★" />;
}

/** What one initializer's row shows, `null` standing for random. */
export function Row({
  entry,
  used,
  current,
}: {
  entry: InitializerView | null;
  used: number;
  current: boolean;
}) {
  const names = useGameDataStore((s) => s.names);
  const pinned = useInitializerBrowserStore((s) => s.pinned);
  const defaultKey = useInitializerBrowserStore((s) => s.defaultKey);
  const togglePin = useInitializerBrowserStore((s) => s.togglePin);
  const key = entry === null ? RANDOM_KEY : entry.name;
  const label = entry === null ? null : entryLabel(entry, names);
  const pin = pinned.includes(key);
  const isDefault = entry === null ? defaultKey === null : entry.name === defaultKey;
  return (
    <>
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
    </>
  );
}
