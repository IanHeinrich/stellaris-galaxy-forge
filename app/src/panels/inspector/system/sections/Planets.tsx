import { useState } from "react";
import type { PlanetSummary } from "../../../../generated/PlanetSummary";
import type { SystemDetails } from "../../../../generated/SystemDetails";
import { isStarClass } from "../../../../lib/details/labels";
import { resourceRows } from "../../../../lib/details/resources";
import { initClassLabel } from "../../../../lib/initializer/initializerRows";
import { templateName } from "../../../../lib/names";
import { useDetailsStore } from "../../../../store/detailsStore";
import { useFileSessionStore } from "../../../../store/fileSessionStore";
import { useGameDataStore } from "../../../../store/gameDataStore";
import { useInspectorStore } from "../../../../store/inspectorStore";
import { Chip, DrillRow, Empty, Icon, MoreButton, Section, Swatch } from "../../parts";
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

function SizeAndPops({ size, pops }: { size: number | null; pops: number }) {
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

export function PlanetRow({
  planet,
  details,
  editable,
}: {
  planet: PlanetSummary;
  details: SystemDetails;
  editable: boolean;
}) {
  const icons = useDetailsStore((s) => s.resourceIcons);
  const classes = useGameDataStore((s) => s.planetClasses);
  const names = useGameDataStore((s) => s.names);
  const open = useInspectorStore((s) => s.open);
  const sprite = classes.get(planet.class)?.icon_sprite;
  const rows = resourceRows({ ...details, resources: planet.deposits }, icons);
  const wide = rows.length > INLINE_RESOURCES;
  // The game localises the class key "random" to nothing, so an empty entry is a miss.
  const unrolled = planet.class === "" || planet.class === "random";
  const classText =
    names.get(planet.class) ||
    (unrolled && planet.moon ? "random moon" : initClassLabel(planet.class));
  const named = templateName(planet);
  const name = named === "" ? classText.charAt(0).toUpperCase() + classText.slice(1) : named;
  return (
    <DrillRow
      className={`ins-prow${planet.moon ? " moon" : ""}${wide ? " wide" : ""}`}
      requires="details"
      title={editable ? "Open this star's page to change its type and size" : undefined}
      onOpen={() => open({ ref: { kind: "planet", id: planet.id }, label: name })}
    >
      <PlanetIcon planetClass={planet.class} sprite={sprite} />
      <span>
        <span className="l1">
          {planet.colonised && <Swatch owner={planet.owner} />}
          {name}
          {planet.capital && <Chip>capital</Chip>}
          {planet.pre_ftl && <Chip>pre-FTL</Chip>}
          {editable && (
            <span className="ins-edit-chip">
              <span aria-hidden="true">✎</span> Edit
            </span>
          )}
        </span>
        <span className="l2">
          {named !== "" && classText}
          {planet.moon && !unrolled && <span>moon</span>}
          <SizeAndPops size={planet.size} pops={planet.pops} />
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
  const scenario = useFileSessionStore((s) => s.kind === "scenario");
  const [all, setAll] = useState(false);
  const isStar = (p: PlanetSummary) => isStarClass(p.class, classes, starClasses);
  const planets = orderedPlanets(details.planets, isStar);
  const totals = planetTotals(details.planets);
  const shown = all ? planets : planets.slice(0, LIST_LIMIT);
  const summary = [
    `${totals.colonies} colonies`,
    totals.pops > 0 ? `${formatPops(totals.pops)} pops` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Section id="system.planets" title="Planets" count={totals.planets} summary={summary}>
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
            <PlanetRow key={p.id} planet={p} details={details} editable={!scenario && isStar(p)} />
          ))}
          {!all && planets.length > LIST_LIMIT && (
            <MoreButton count={planets.length - LIST_LIMIT} onClick={() => setAll(true)} />
          )}
        </>
      )}
    </Section>
  );
}
