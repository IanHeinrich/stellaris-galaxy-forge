import { useState, type MouseEvent } from "react";
import type { PlanetSummary } from "../../../../generated/PlanetSummary";
import type { SystemDetails } from "../../../../generated/SystemDetails";
import { bodyClassName, bodyName, boundsText } from "../../../../lib/details/labels";
import { resourceRows } from "../../../../lib/details/resources";
import { isStarBody } from "../../../../lib/details/starBody";
import { bodyEditHint } from "../../../../lib/details/planetEdits";
import { templateName } from "../../../../lib/names";
import { useDetailsStore } from "../../../../store/detailsStore";
import { useCanEdit, useFileSessionStore } from "../../../../store/fileSessionStore";
import { useGameDataStore } from "../../../../store/gameDataStore";
import { bodyEntry, useInspectorStore } from "../../../../store/inspectorStore";
import { useMapChromeStore } from "../../../../store/mapChromeStore";
import { canEnterSystem, useSceneStore, useSceneSystem } from "../../../../store/sceneStore";
import { Chip, Icon } from "../../../parts";
import { DrillRow, Empty, MoreButton, Section, Swatch } from "../../parts";
import { PlanetIcon, Pills, PlanetSize } from "./bodies";
import {
  depositTitle,
  formatPops,
  habitable,
  INLINE_RESOURCES,
  LIST_LIMIT,
  orderedPlanets,
  planetTotals,
  POP_ICON_KEY,
} from "../../rows";

function SizeAndPops({ size, pops }: { size: string | number | null; pops: number }) {
  return (
    <>
      {size !== null && <PlanetSize size={size} />}
      {pops > 0 && (
        <span className="pops">
          <Icon className="gi" keys={[POP_ICON_KEY]} glyph="⚇" />
          {formatPops(pops)}
        </span>
      )}
    </>
  );
}

/** Opens the menu of body `id`'s row at the pointer, in the map area's pixels the menu is placed in. */
function openRowMenu(e: MouseEvent, system: number, id: number): void {
  e.preventDefault();
  const area = document.querySelector(".map-area")?.getBoundingClientRect();
  useMapChromeStore.getState().openContextMenu({
    target: { kind: "bodyRow", system, id },
    x: e.clientX - (area?.left ?? 0),
    y: e.clientY - (area?.top ?? 0),
  });
}

export function PlanetRow({
  planet,
  details,
  editHint,
}: {
  planet: PlanetSummary;
  details: SystemDetails;
  /** Why the row carries the Edit chip, or `null` when its page edits nothing. */
  editHint: string | null;
}) {
  const icons = useDetailsStore((s) => s.resourceIcons);
  const classes = useGameDataStore((s) => s.planetClasses);
  const names = useGameDataStore((s) => s.names);
  const open = useInspectorStore((s) => s.open);
  const enterable = useFileSessionStore(canEnterSystem);
  const sprite = classes.get(planet.class)?.icon_sprite;
  const rows = resourceRows({ ...details, resources: planet.deposits }, icons);
  const wide = rows.length > INLINE_RESOURCES;
  const unrolled = planet.class === "" || planet.class === "random";
  const classText = bodyClassName(planet.class, names, planet.moon);
  const named = templateName(planet);
  const name = bodyName(planet, names);
  const size = planet.layout?.size ? boundsText(planet.layout.size) : planet.size;
  return (
    <DrillRow
      className={`ins-prow${planet.moon ? " moon" : ""}${wide ? " wide" : ""}`}
      title={editHint ?? undefined}
      onOpen={() => open(bodyEntry(details.id, planet.id, name))}
      onContextMenu={enterable ? (e) => openRowMenu(e, details.id, planet.id) : undefined}
    >
      <PlanetIcon planetClass={planet.class} sprite={sprite} seed={planet.id} />
      <span>
        <span className="l1">
          {planet.colonised && <Swatch owner={planet.owner} />}
          {name}
          {planet.capital && <Chip>capital</Chip>}
          {planet.pre_ftl && <Chip>pre-FTL</Chip>}
          {editHint !== null && (
            <span className="ins-edit-chip">
              <span aria-hidden="true">✎</span> Edit
            </span>
          )}
        </span>
        <span className="l2">
          {named !== "" && classText}
          {planet.moon && !unrolled && <span>moon</span>}
          <SizeAndPops size={size} pops={planet.pops} />
          {planet.orbit !== null && <span>orbit {Math.round(planet.orbit)}</span>}
          {!planet.colonised && habitable(planet) && (
            <span className="ok">habitable, unclaimed</span>
          )}
          {wide && <span>{rows.length} resources</span>}
        </span>
        {wide && (
          <span className="l3" title={depositTitle(planet.deposit_keys)}>
            <Pills rows={rows} />
          </span>
        )}
      </span>
      {!wide && (
        <span className="rs" title={depositTitle(planet.deposit_keys)}>
          <Pills rows={rows} />
        </span>
      )}
    </DrillRow>
  );
}

/** The whole system, heading the totals: a star with one orbit, on the disc the bodies use. */
function SystemIcon() {
  return (
    <span className="pi system" aria-hidden="true">
      <svg viewBox="0 0 20 20">
        <ellipse cx="10" cy="10" rx="8" ry="3.2" />
        <circle cx="10" cy="10" r="2.4" />
      </svg>
    </span>
  );
}

export function PlanetSection({ details }: { details: SystemDetails }) {
  const icons = useDetailsStore((s) => s.resourceIcons);
  const classes = useGameDataStore((s) => s.planetClasses);
  const starClasses = useGameDataStore((s) => s.starClasses);
  const bodies = useCanEdit("bodies");
  const enterable = useFileSessionStore(canEnterSystem);
  const inView = useSceneSystem() === details.id;
  const enterSystem = useSceneStore((s) => s.enterSystem);
  const [all, setAll] = useState(false);
  const isStar = (p: PlanetSummary) => isStarBody(p.class, classes, starClasses);
  const planets = orderedPlanets(details.planets, isStar);
  const totals = planetTotals(details.planets);
  const shown = all ? planets : planets.slice(0, LIST_LIMIT);
  const summary = [
    `${totals.colonies} colonies`,
    totals.pops > 0 ? `${formatPops(totals.pops)} pops` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const openView =
    enterable && !inView ? (
      <button type="button" className="link" onClick={() => enterSystem(details.id)}>
        Open system view
      </button>
    ) : undefined;
  return (
    <Section
      id="system.planets"
      title="Planets"
      count={totals.planets}
      summary={summary}
      action={openView}
    >
      {planets.length === 0 ? (
        <Empty>No planets in this system.</Empty>
      ) : (
        <>
          <div className="ins-total wide">
            <SystemIcon />
            <span>
              <span className="l1">System total</span>
              <span className="l2">
                {totals.planets} planets · {totals.colonies} colonies
                {totals.preFtl > 0 && ` · ${totals.preFtl} pre-FTL`}
                <SizeAndPops size={null} pops={totals.pops} />
              </span>
              <span className="l3">
                <Pills rows={resourceRows(details, icons)} />
              </span>
            </span>
          </div>
          {shown.map((p) => (
            <PlanetRow
              key={p.id}
              planet={p}
              details={details}
              editHint={bodyEditHint(p.class, bodies, classes, starClasses)}
            />
          ))}
          {!all && planets.length > LIST_LIMIT && (
            <MoreButton count={planets.length - LIST_LIMIT} onClick={() => setAll(true)} />
          )}
        </>
      )}
    </Section>
  );
}
