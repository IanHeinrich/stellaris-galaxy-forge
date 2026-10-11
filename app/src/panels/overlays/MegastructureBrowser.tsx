import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import type { MegastructureTypeView } from "../../generated/MegastructureTypeView";
import {
  formatAmount,
  resourceAbbrev,
  resourceLabel,
  type ResourceRow,
} from "../../lib/details/resources";
import {
  familyPick,
  matchingPicks,
  type MegastructureFamily,
  type MegastructurePick,
} from "../../lib/megastructurePicks";
import { megastructureThumbKeys, type MegastructurePreview } from "../../lib/megastructurePreview";
import { gridStep } from "../gridKeys";
import { IconPicker } from "../IconPicker";
import { ENTER } from "../keys";
import { FilterField } from "../parts";
import { groupItems } from "../tileGroups";
import { useTextureUrl } from "../useTextureUrl";

function Thumb({ keys, className }: { keys: readonly string[]; className: string }) {
  const url = useTextureUrl(keys);
  return <span className={className}>{url !== undefined && <img src={url} alt="" />}</span>;
}

/** How many tiles a row of `grid` holds, as its layout resolved them. */
function columnsOf(grid: HTMLElement): number {
  return getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length || 1;
}

/**
 * The type chooser: a filter over every type, the family dropdown, and the tiles of the open
 * family, or of every type the filter matches. A tile selects its type; arrows move the
 * selection and Enter adds it.
 */
export function MegastructureTiles({
  families,
  types,
  culture,
  current,
  query,
  onQuery,
  onSelect,
  onConfirm,
}: {
  families: readonly MegastructureFamily[];
  types: ReadonlyMap<string, MegastructureTypeView>;
  /** The culture the models are drawn in: the chosen owner's, null for none. */
  culture: string | null;
  current: MegastructurePick;
  query: string;
  onQuery: (query: string) => void;
  onSelect: (key: string) => void;
  onConfirm: () => void;
}) {
  const id = useId();
  const grid = useRef<HTMLUListElement>(null);
  const above = useRef<HTMLDivElement>(null);
  const filtering = query.trim() !== "";
  const family = families.find((f) => f.key === current.familyKey) ?? families[0];
  const tiles = filtering ? matchingPicks(families, query) : family.picks;
  const active = tiles.findIndex((pick) => pick.key === current.key);
  const tileId = (i: number) => `${id}-tile-${i}`;

  useEffect(() => {
    const tile = active >= 0 ? document.getElementById(tileId(active)) : null;
    tile?.scrollIntoView({ block: "nearest" });
  });

  const onGridKey = (e: KeyboardEvent) => {
    if (tiles.length === 0) return;
    if (e.key === ENTER) onConfirm();
    else {
      const to = grid.current && gridStep(active, e.key, tiles.length, columnsOf(grid.current));
      if (to === null) return;
      if (to !== "above") onSelect(tiles[to].key);
      else above.current?.querySelector<HTMLElement>("button, input")?.focus();
    }
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="megastructure-add-pick">
      <div className="megastructure-add-find" ref={above}>
        <FilterField label="Filter types" value={query} onChange={onQuery} />
        {filtering ? (
          <span className="muted">
            {tiles.length === 1 ? "1 type matches" : `${tiles.length} types match`}
          </span>
        ) : (
          <IconPicker
            label="Megastructure family"
            current={{ key: family.key, label: family.label, note: family.note }}
            items={groupItems(families)}
            triggerClassName="edit-field"
            onPick={(key) => {
              const picked = families.find((f) => f.key === key);
              if (picked !== undefined) onSelect(familyPick(picked).key);
            }}
          />
        )}
      </div>
      <ul
        className="megastructure-add-grid"
        role="listbox"
        aria-label={filtering ? "Matching megastructure types" : `${family.label} stages`}
        aria-activedescendant={active >= 0 ? tileId(active) : undefined}
        tabIndex={0}
        ref={grid}
        onKeyDown={onGridKey}
      >
        {tiles.length === 0 && (
          <li className="muted" role="presentation">
            No type matches.
          </li>
        )}
        {tiles.map((pick, i) => (
          <li
            key={pick.key}
            id={tileId(i)}
            role="option"
            className="megastructure-add-tile"
            aria-selected={pick.key === current.key}
            title={filtering ? `${pick.label} (${pick.family})` : pick.label}
            onClick={() => onSelect(pick.key)}
            onDoubleClick={onConfirm}
          >
            <Thumb
              className="megastructure-add-thumb"
              keys={megastructureThumbKeys(types.get(pick.key), culture)}
            />
            <span className="megastructure-add-caption">{pick.label}</span>
          </li>
        ))}
      </ul>
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

/** The selected type: its picture, name, stage, what it produces and the game's description. */
export function MegastructurePreviewPane({
  preview,
  type,
  culture,
}: {
  preview: MegastructurePreview;
  type: MegastructureTypeView | undefined;
  culture: string | null;
}) {
  return (
    <aside className="megastructure-add-preview" aria-label="Selected megastructure">
      <Thumb className="megastructure-add-picture" keys={megastructureThumbKeys(type, culture)} />
      <h2>{preview.label}</h2>
      {preview.stage !== null && <div className="muted">{preview.stage}</div>}
      {preview.produces.length > 0 && (
        <div className="megastructure-add-produces">
          <span className="muted">Produces each month</span>
          <ul>
            {preview.produces.map((row) => (
              <Produced key={row.resource} row={row} />
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
