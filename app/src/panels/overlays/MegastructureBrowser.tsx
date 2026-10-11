import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import type { MegastructureTypeView } from "../../generated/MegastructureTypeView";
import {
  formatAmount,
  resourceAbbrev,
  resourceLabel,
  type ResourceRow,
} from "../../lib/details/resources";
import {
  entryStages,
  NO_MODEL,
  NO_MODEL_NOTE,
  type MegastructureChain,
  type MegastructureEntry,
} from "../../lib/megastructurePicks";
import {
  hasModel,
  megastructureThumbKeys,
  type MegastructurePreview,
} from "../../lib/megastructurePreview";
import { groupedGridStep } from "../gridKeys";
import { ENTER } from "../keys";
import { FilterField } from "../parts";
import { useTextureUrl } from "../useTextureUrl";

const NO_KEYS: readonly string[] = [];

/** Whether `ref`'s element has come into view; at once where the browser cannot tell. */
function useSeen(ref: RefObject<HTMLElement | null>, watching: boolean): boolean {
  const [seen, setSeen] = useState(() => !watching || typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const element = ref.current;
    if (seen || element === null) return;
    const watch = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
    });
    watch.observe(element);
    return () => watch.disconnect();
  }, [ref, seen]);
  return seen;
}

/** A type's picture; a `lazy` one asks for its model only once it scrolls into view. */
function Thumb({
  keys,
  className,
  lazy = false,
}: {
  keys: readonly string[];
  className: string;
  lazy?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useSeen(ref, lazy);
  const url = useTextureUrl(seen ? keys : NO_KEYS);
  return (
    <span className={className} ref={ref}>
      {url !== undefined && <img src={url} alt="" />}
    </span>
  );
}

/** How many tiles a row of `grid` holds, as its layout resolved them. */
function columnsOf(grid: HTMLElement): number {
  const row = grid.querySelector<HTMLElement>(".megastructure-add-row");
  if (row === null) return 1;
  return getComputedStyle(row).gridTemplateColumns.split(" ").filter(Boolean).length || 1;
}

/**
 * The megastructure list: a filter over every megastructure and stage name, and the
 * megastructures that match under their section's heading, the base game's first. Up and Down
 * move the selection.
 */
export function MegastructureList({
  entries,
  current,
  query,
  onQuery,
  onSelect,
  onConfirm,
}: {
  entries: readonly MegastructureEntry[];
  current: MegastructureEntry | null;
  query: string;
  onQuery: (query: string) => void;
  onSelect: (entry: MegastructureEntry) => void;
  onConfirm: () => void;
}) {
  const id = useId();
  const optionId = (i: number) => `${id}-entry-${i}`;
  const active = current === null ? -1 : entries.findIndex((e) => e.key === current.key);

  useEffect(() => {
    const option = active >= 0 ? document.getElementById(optionId(active)) : null;
    option?.scrollIntoView({ block: "nearest" });
  });

  const onKey = (e: KeyboardEvent) => {
    if (entries.length === 0) return;
    if (e.key === ENTER) {
      if (active >= 0) onConfirm();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const step = e.key === "ArrowDown" ? 1 : -1;
      const to = Math.min(entries.length - 1, Math.max(0, active + step));
      onSelect(entries[to]);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="megastructure-add-list-column">
      <FilterField label="Filter megastructures" value={query} onChange={onQuery} />
      <ul
        className="megastructure-add-list"
        role="listbox"
        aria-label="Megastructures"
        aria-activedescendant={active >= 0 ? optionId(active) : undefined}
        tabIndex={0}
        onKeyDown={onKey}
      >
        {entries.length === 0 && (
          <li className="muted" role="presentation">
            No megastructure matches.
          </li>
        )}
        {entries.flatMap((entry, i) => {
          const heading =
            i === 0 || entries[i - 1].section !== entry.section ? (
              <li
                key={`section-${entry.key}`}
                className="megastructure-add-section"
                role="presentation"
              >
                {entry.section ?? "Base game"}
              </li>
            ) : null;
          const option = (
            <li
              key={entry.key}
              id={optionId(i)}
              role="option"
              aria-selected={entry.key === current?.key}
              onClick={() => onSelect(entry)}
              onDoubleClick={onConfirm}
            >
              {entry.label}
            </li>
          );
          return heading === null ? [option] : [heading, option];
        })}
      </ul>
    </div>
  );
}

function Tile({
  stage,
  id,
  selected,
  type,
  culture,
  onSelect,
  onConfirm,
}: {
  stage: { key: string; label: string; refused: string | null };
  id: string;
  selected: boolean;
  type: MegastructureTypeView | undefined;
  culture: string | null;
  onSelect: (key: string) => void;
  onConfirm: () => void;
}) {
  const refused = stage.refused !== null;
  return (
    <li
      id={id}
      role="option"
      className={
        refused ? "megastructure-add-tile megastructure-add-refused" : "megastructure-add-tile"
      }
      aria-selected={selected}
      aria-disabled={refused || undefined}
      title={stage.refused ?? stage.label}
      onClick={() => onSelect(stage.key)}
      onDoubleClick={refused ? undefined : onConfirm}
    >
      <Thumb
        className="megastructure-add-thumb"
        keys={megastructureThumbKeys(type, culture)}
        lazy
      />
      <span className="megastructure-add-caption">{stage.label}</span>
      {!hasModel(type) && <span className="megastructure-add-mark muted">{NO_MODEL}</span>}
    </li>
  );
}

/**
 * The stages of the selected megastructure as tiles, one row per upgrade chain with a label that
 * tells the rows apart. A tile selects its stage; arrows move the selection, Up and Down to the
 * same column of the row above or below, and Enter adds it.
 */
export function MegastructureStages({
  entry,
  types,
  culture,
  current,
  onSelect,
  onConfirm,
}: {
  entry: MegastructureEntry;
  types: ReadonlyMap<string, MegastructureTypeView>;
  /** The culture the models are drawn in: the system owner's, null for none. */
  culture: string | null;
  current: string;
  onSelect: (key: string) => void;
  onConfirm: () => void;
}) {
  const id = useId();
  const grid = useRef<HTMLDivElement>(null);
  const stages = entryStages(entry);
  const active = stages.findIndex((stage) => stage.key === current);
  const tileId = (key: string) => `${id}-tile-${key}`;

  useEffect(() => {
    const tile = document.getElementById(tileId(current));
    tile?.scrollIntoView({ block: "nearest" });
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === ENTER) {
      if (active >= 0 && stages[active].refused === null) onConfirm();
    } else {
      const rows = entry.chains.map((chain) => ({ items: chain.stages }));
      const to = grid.current && groupedGridStep(rows, current, e.key, columnsOf(grid.current));
      if (to === null) return;
      onSelect(to);
    }
    e.preventDefault();
    e.stopPropagation();
  };

  const row = (chain: MegastructureChain) => (
    <div key={chain.first} role="group" aria-label={chain.label ?? `${entry.label} stages`}>
      {chain.label !== null && (
        <div className="megastructure-add-row-label muted">{chain.label}</div>
      )}
      <ul className="megastructure-add-row" role="presentation">
        {chain.stages.map((stage) => (
          <Tile
            key={stage.key}
            stage={stage}
            id={tileId(stage.key)}
            selected={stage.key === current}
            type={types.get(stage.key)}
            culture={culture}
            onSelect={onSelect}
            onConfirm={onConfirm}
          />
        ))}
      </ul>
    </div>
  );

  return (
    <div
      className="megastructure-add-grid"
      role="listbox"
      aria-label={`${entry.label} stages`}
      aria-activedescendant={active >= 0 ? tileId(current) : undefined}
      tabIndex={0}
      ref={grid}
      onKeyDown={onKey}
    >
      {entry.chains.map(row)}
    </div>
  );
}

function Produced({ row }: { row: ResourceRow }) {
  const url = useTextureUrl([row.sprite]);
  const amount = formatAmount(row.amount);
  return (
    <li>
      {url ? <img src={url} alt="" /> : <i>{resourceAbbrev(row.resource)}</i>}
      {row.amount > 0 ? `+${amount}` : amount} {resourceLabel(row.resource)}
    </li>
  );
}

/**
 * The selected stage: its picture, name, row and stage, why the save would refuse it here, what
 * it produces and the game's description.
 */
export function MegastructurePreviewPane({
  preview,
  row,
  type,
  culture,
}: {
  preview: MegastructurePreview;
  /** The label of its row, when its megastructure has several. */
  row: string | null;
  type: MegastructureTypeView | undefined;
  culture: string | null;
}) {
  return (
    <aside className="megastructure-add-preview" aria-label="Selected megastructure">
      <Thumb className="megastructure-add-picture" keys={megastructureThumbKeys(type, culture)} />
      <h2>{preview.label}</h2>
      {(row !== null || preview.stage !== null) && (
        <div className="muted">{[row, preview.stage].filter(Boolean).join(" · ")}</div>
      )}
      {preview.refused !== null && <p className="megastructure-add-refusal">{preview.refused}</p>}
      {!preview.model && <p className="muted">{NO_MODEL_NOTE}</p>}
      {preview.produces.length > 0 && (
        <div className="megastructure-add-produces">
          <span className="muted">Produces each month</span>
          <ul>
            {preview.produces.map((produced) => (
              <Produced key={produced.resource} row={produced} />
            ))}
          </ul>
        </div>
      )}
      {preview.description !== null && (
        <p className="megastructure-add-description">{preview.description}</p>
      )}
    </aside>
  );
}
