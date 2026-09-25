import { useEffect, useMemo, useState } from "react";
import type { InitializerView } from "../../../../../generated/InitializerView";
import {
  initializerNameKeys,
  initializerRows,
  starClassLabel,
  type InitializerRow,
} from "../../../../../lib/initializer/initializerRows";
import { useDetailsStore } from "../../../../../store/detailsStore";
import { useGameDataStore } from "../../../../../store/gameDataStore";
import { useNamed } from "../../../../useNamed";
import { Chip, FILTER_MIN, FilterField, Icon } from "../../../../parts";
import { INLINE_RESOURCES } from "../../../rows";
import { PlanetIcon, Pills, PlanetSize } from "../bodies";

function BodyRow({ row }: { row: InitializerRow }) {
  const names = useGameDataStore((s) => s.names);
  const wide = row.resources.length > INLINE_RESOURCES;
  const classText = (row.classKey && names.get(row.classKey)) ?? row.classLabel;
  const name = (row.nameKey && names.get(row.nameKey)) ?? row.nameKey ?? "—";
  return (
    <div className={`ins-prow static${row.moon ? " moon" : ""}${wide ? " wide" : ""}`}>
      <PlanetIcon planetClass={row.planetClass} sprite={row.sprite} />
      <span>
        <span className="l1">
          {name}
          {row.count > 1 && <Chip>×{row.count}</Chip>}
          {row.homePlanet && <Chip>home planet</Chip>}
        </span>
        <span className="l2">
          {classText}
          {row.moon && <span>moon</span>}
          {row.size !== null && <PlanetSize size={row.size} />}
          {row.ring && <span>ring</span>}
          {wide && <span>{row.resources.length} resources</span>}
        </span>
        {wide && (
          <span className="l3">
            <Pills rows={row.resources} />
          </span>
        )}
      </span>
      {!wide && (
        <span className="rs">
          <Pills rows={row.resources} />
        </span>
      )}
    </div>
  );
}

function StarRow({ entry }: { entry: InitializerView }) {
  const names = useGameDataStore((s) => s.names);
  const starClasses = useGameDataStore((s) => s.starClasses);
  const texture = entry.class === null ? undefined : starClasses.get(entry.class)?.texture_key;
  return (
    <div className="ins-prow static wide">
      <Icon className="pi ghost" keys={texture ? [texture] : []} glyph="★" />
      <span>
        <span className="l1">{starClassLabel(entry.class, names)}</span>
        <span className="l2">star</span>
      </span>
    </div>
  );
}

/** What the initializer spawns here: its star, then every planet and moon it places. */
export function InitializerSpawn({ name }: { name: string }) {
  const [query, setQuery] = useState("");
  const ready = useGameDataStore((s) => s.status === "ready");
  const initializers = useGameDataStore((s) => s.initializers);
  const classes = useGameDataStore((s) => s.planetClasses);
  const deposits = useGameDataStore((s) => s.deposits);
  const icons = useDetailsStore((s) => s.resourceIcons);

  // Reading the install again once game data is ready is what fills the list in.
  useEffect(() => void useGameDataStore.getState().loadInitializers(), [ready]);

  const entry = useMemo(
    () => initializers?.find((e) => e.name === name) ?? null,
    [initializers, name],
  );
  const rows = useMemo(
    () => (entry === null ? [] : initializerRows(entry, classes, deposits, icons)),
    [entry, classes, deposits, icons],
  );
  useNamed(entry === null ? [] : initializerNameKeys(entry, rows));

  if (entry === null) return null;
  const needle = query.trim().toLowerCase();
  const shown =
    needle === ""
      ? rows
      : rows.filter((row) =>
          `${row.nameKey ?? ""} ${row.classLabel}`.toLowerCase().includes(needle),
        );
  return (
    <>
      <StarRow entry={entry} />
      {rows.length > 0 && <div className="muted ins-spawn-head">Planets · {rows.length}</div>}
      {rows.length > FILTER_MIN && (
        <FilterField label={`Filter ${rows.length} bodies`} value={query} onChange={setQuery} />
      )}
      {shown.map((row) => (
        <BodyRow key={row.id} row={row} />
      ))}
    </>
  );
}
