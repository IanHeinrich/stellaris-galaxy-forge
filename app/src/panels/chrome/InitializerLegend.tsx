import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { groupInitializers, modRefs } from "../../lib/initializer/initializerGroups";
import {
  INITIALIZER_SEARCH_MIN,
  initializerLabel,
  legendGroups,
  type InitializerCount,
} from "../../lib/initializer/initializerLabels";
import { useGameDataStore } from "../../store/gameDataStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { FilterField } from "../inspector/parts";
import { ESCAPE } from "../keys";
import { useOutsidePress } from "../useOutsidePress";
import "./chrome.css";
import type { Pressed } from "./layerState";
import { EyeRow } from "./Menu";

/** What the legend flyout and the chevron that opens it are called. */
export const LEGEND_LABEL = "Initializer keys legend";

/** The gap the flyout keeps from the menu it hangs beside and from the window's edges. */
const FLYOUT_GAP = 6;

function KeyRow({ count, hidden }: { count: InitializerCount; hidden: boolean }) {
  const toggleInitializer = useMapChromeStore((s) => s.toggleInitializer);
  return (
    <EyeRow
      className="menu-item sub"
      pressed={!hidden}
      onClick={() => toggleInitializer(count.key)}
    >
      <span className="muted">{initializerLabel(count.key)}</span>
      <span className="count">{count.count}</span>
    </EyeRow>
  );
}

/** One game-data group: its eye hides every key under it, or shows them all once they all are. */
function GroupRow({ label, keys }: { label: string; keys: string[] }) {
  const hidden = useMapChromeStore((s) => s.hiddenInitializers);
  const toggleInitializers = useMapChromeStore((s) => s.toggleInitializers);
  const shown = keys.filter((key) => !hidden.has(key)).length;
  const pressed: Pressed = shown === keys.length ? "true" : shown === 0 ? "false" : "mixed";
  return (
    <EyeRow pressed={pressed} onClick={() => toggleInitializers(keys)}>
      <span>{label}</span>
      <span className="count">{keys.length}</span>
    </EyeRow>
  );
}

/**
 * Puts the flyout beside the menu, level with the row it belongs to, or under that row when the
 * window has no room to its right. Laid out before the paint, so it never shows anywhere else,
 * and again whenever the window, the anchor row or the flyout's own content moves under it.
 */
function useFlyoutPlace(anchor: RefObject<HTMLDivElement | null>) {
  const self = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = self.current;
    const parent = node?.parentElement;
    if (!node || !parent) return;
    const place = () => {
      const row = anchor.current?.getBoundingClientRect();
      const pane = parent.getBoundingClientRect();
      if (!row) return;
      const box = node.getBoundingClientRect();
      const below = pane.right + FLYOUT_GAP + box.width > window.innerWidth - FLYOUT_GAP;
      const top = below ? row.bottom - pane.top : row.top - pane.top;
      const lowest = window.innerHeight - FLYOUT_GAP - box.height - pane.top;
      node.style.left = `${below ? 0 : pane.width + FLYOUT_GAP}px`;
      node.style.top = `${Math.max(FLYOUT_GAP - pane.top, Math.min(top, lowest))}px`;
    };
    place();
    const body = parent.querySelector<HTMLElement>(".menu-body");
    const resize = new ResizeObserver(place);
    resize.observe(node);
    window.addEventListener("resize", place);
    body?.addEventListener("scroll", place);
    return () => {
      resize.disconnect();
      window.removeEventListener("resize", place);
      body?.removeEventListener("scroll", place);
    };
  }, [anchor]);
  return self;
}

/**
 * The initializers legend, beside the menu rather than in it: every key in the document with
 * its count, each hiding the label of the systems that carry it and dimming their stars.
 * Grouped as the loaded game data groups them, flat and most used first without it, and
 * searchable once it outgrows the flyout.
 */
export function InitializerLegend({
  counts,
  anchor,
  onClose,
}: {
  counts: InitializerCount[];
  anchor: RefObject<HTMLDivElement | null>;
  onClose: () => void;
}) {
  const hidden = useMapChromeStore((s) => s.hiddenInitializers);
  const showAllInitializers = useMapChromeStore((s) => s.showAllInitializers);
  const hideAllInitializers = useMapChromeStore((s) => s.hideAllInitializers);
  const initializers = useGameDataStore((s) => s.initializers);
  const summary = useGameDataStore((s) => s.summary);
  const [query, setQuery] = useState("");
  const self = useFlyoutPlace(anchor);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ESCAPE) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose]);
  useOutsidePress(true, onClose, self, anchor);

  const groups = useMemo(
    () =>
      initializers === null
        ? []
        : legendGroups(counts, groupInitializers(initializers, modRefs(summary?.mods ?? []))),
    [counts, initializers, summary],
  );

  const needle = query.trim().toLowerCase();
  const matches = (c: InitializerCount) => initializerLabel(c.key).toLowerCase().includes(needle);
  const random = counts.find((c) => c.key === "");
  const named = counts.filter((c) => c.key !== "");
  const flat = needle === "" ? named : named.filter(matches);
  const grouped = needle === "" && groups.length > 0;
  return (
    <div className="menu-flyout" role="dialog" aria-label={LEGEND_LABEL} ref={self}>
      {counts.length > INITIALIZER_SEARCH_MIN && (
        <FilterField
          label={`Filter ${counts.length} initializers`}
          value={query}
          onChange={setQuery}
        />
      )}
      <div className="menu-list">
        {random && matches(random) && <KeyRow count={random} hidden={hidden.has("")} />}
        {grouped
          ? groups.map((group) => (
              <div key={group.id}>
                <GroupRow label={group.label} keys={group.rows.map((row) => row.key)} />
                {group.rows.map((row) => (
                  <KeyRow key={row.key} count={row} hidden={hidden.has(row.key)} />
                ))}
              </div>
            ))
          : flat.map((count) => (
              <KeyRow key={count.key} count={count} hidden={hidden.has(count.key)} />
            ))}
      </div>
      <button type="button" role="menuitem" className="menu-item sub" onClick={showAllInitializers}>
        <span className="muted">Show all</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="menu-item sub"
        onClick={() => hideAllInitializers(counts.map((c) => c.key))}
      >
        <span className="muted">Hide all</span>
      </button>
    </div>
  );
}
