import { Fragment, useState, type MouseEvent, type ReactNode } from "react";
import type { CountRange } from "../../../../generated/CountRange";
import type { PlanetSummary } from "../../../../generated/PlanetSummary";
import type { SystemDetails } from "../../../../generated/SystemDetails";
import { bodyClassName, bodyName, boundsText } from "../../../../lib/details/labels";
import { resourceRows } from "../../../../lib/details/resources";
import { isStarBody } from "../../../../lib/details/starBody";
import { bodyEditHint } from "../../../../lib/details/planetEdits";
import { templateName } from "../../../../lib/names";
import {
  blockCountTitle,
  blockNoun,
  bodyBlocks,
  drawWords,
  moonsEach,
} from "../../../../lib/details/bodyBlocks";
import {
  countWords,
  everyBodyFrom,
  isAsteroidClass,
  isRanged,
  moonsAndAsteroids,
  PLANETS_FROM_SCRIPT,
  rangeWords,
  type PlanetCounts,
} from "../../../../lib/details/spawnFacts";
import { useDetailsStore } from "../../../../store/detailsStore";
import { useCanEdit, useFileSessionStore } from "../../../../store/fileSessionStore";
import { useGameDataStore } from "../../../../store/gameDataStore";
import { bodyEntry, useInspectorStore } from "../../../../store/inspectorStore";
import { useMapChromeStore } from "../../../../store/mapChromeStore";
import { canEnterSystem, useSceneStore, useSceneSystem } from "../../../../store/sceneStore";
import { Chip, Icon } from "../../../parts";
import { DrillRow, Empty, MoreButton, Section, Swatch } from "../../parts";
import { Rolled, Unknown } from "../../states";
import { usePlanetCounter } from "../usePlanetCounter";
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

/** The count at the right of a block's row, rolled where the game draws it, with its sentence on hover. */
function BlockCount({
  count,
  moon,
  asteroid,
}: {
  count: CountRange;
  moon: boolean;
  asteroid: boolean;
}) {
  const ranged = isRanged(count);
  return (
    <span
      className={ranged ? "ins-block-count ins-st-rolled" : "ins-block-count"}
      title={blockCountTitle(count, moon, asteroid)}
    >
      {ranged ? rangeWords(count) : `×${count.max}`}
    </span>
  );
}

/** The parts of a row's second line, with a dot between each where `dotted`. */
function SecondLine({ parts, dotted }: { parts: ReactNode[]; dotted: boolean }) {
  const shown = parts.filter((part) => part !== null && part !== false);
  return (
    <>
      {shown.map((part, i) => (
        <Fragment key={i}>
          {dotted && i > 0 && <span aria-hidden="true">·</span>}
          {part}
        </Fragment>
      ))}
    </>
  );
}

export function PlanetRow({
  planet,
  details,
  editHint,
  count = null,
  moons = 0,
  flat = false,
}: {
  planet: PlanetSummary;
  details: SystemDetails;
  /** Why the row carries the Edit chip, or `null` when its page edits nothing. */
  editHint: string | null;
  /** How many its block places, where the row stands for a block placed other than once. */
  count?: CountRange | null;
  /** On a block of planets, the most moons each of them has. */
  moons?: number;
  /** A moon listed on its planet's page: not indented and not labelled a moon. */
  flat?: boolean;
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
  const spawn = planet.spawn;
  const state = spawn?.class.state;
  const asteroid = isAsteroidClass(planet.class, classes);
  const plural = count !== null && count.max > 1;
  const noun = plural
    ? blockNoun(planet.moon, asteroid)
    : asteroid
      ? "asteroid"
      : planet.moon
        ? "moon"
        : "planet";
  const random = unrolled || (state !== undefined && state !== "fixed");
  const described = named === "" && (plural || random);
  const title = !described
    ? name
    : random
      ? `Random ${noun}`
      : noun.charAt(0).toUpperCase() + noun.slice(1);
  const shownName: ReactNode =
    named !== "" || state === undefined || state === "fixed" ? (
      title
    ) : state === "rolled" ? (
      <Rolled>{title}</Rolled>
    ) : (
      <Unknown>{title}</Unknown>
    );
  const classShown: ReactNode =
    named === "" && !described ? null : spawn?.class.state === "rolled" ? (
      <Rolled>{named === "" ? drawWords(spawn.class.pool) : "rolled class"}</Rolled>
    ) : state === "unknown" ? (
      <Unknown>class picked at game start</Unknown>
    ) : described && unrolled ? (
      "any class"
    ) : (
      classText
    );
  const countMark =
    count === null ? null : <BlockCount count={count} moon={planet.moon} asteroid={asteroid} />;
  return (
    <DrillRow
      className={`ins-prow${planet.moon && !flat ? " moon" : ""}${wide ? " wide" : ""}`}
      title={editHint ?? undefined}
      onOpen={() => open(bodyEntry(details.id, planet.id, name))}
      onContextMenu={enterable ? (e) => openRowMenu(e, details.id, planet.id) : undefined}
    >
      <PlanetIcon planetClass={planet.class} sprite={sprite} seed={planet.id} />
      <span>
        <span className="l1">
          {planet.colonised && <Swatch owner={planet.owner} />}
          {shownName}
          {planet.capital && <Chip>capital</Chip>}
          {planet.pre_ftl && <Chip>pre-FTL</Chip>}
          {spawn?.starting_planet && <Chip>start planet</Chip>}
          {editHint !== null && (
            <span className="ins-edit-chip">
              <span aria-hidden="true">✎</span> Edit
            </span>
          )}
        </span>
        <span className="l2">
          <SecondLine
            dotted={spawn !== undefined || described}
            parts={[
              classShown,
              planet.moon && !flat && !unrolled && count === null && <span>moon</span>,
              size !== null && <PlanetSize size={size} />,
              planet.pops > 0 && (
                <span className="pops">
                  <Icon className="gi" keys={[POP_ICON_KEY]} glyph="⚇" />
                  {formatPops(planet.pops)}
                </span>
              ),
              moons > 0 && <span>{moonsEach(moons)}</span>,
              planet.orbit !== null && count === null && (
                <span>orbit {Math.round(planet.orbit)}</span>
              ),
              !planet.colonised && habitable(planet) && (
                <span className="ok">habitable, unclaimed</span>
              ),
              wide && <span>{rows.length} resources</span>,
            ]}
          />
        </span>
        {wide && (
          <span className="l3" title={depositTitle(planet.deposit_keys)}>
            <Pills rows={rows} />
          </span>
        )}
      </span>
      {(!wide || countMark !== null) && (
        <span className="rs" title={depositTitle(planet.deposit_keys)}>
          {countMark}
          {!wide && <Pills rows={rows} />}
        </span>
      )}
    </DrillRow>
  );
}

/** `14 planets`, `2 to 10 planets`, or what a script's count says. */
function planetsText(counts: PlanetCounts): string {
  return counts.planets === null ? PLANETS_FROM_SCRIPT : countWords(counts.planets, "planet");
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
  const blocks = bodyBlocks(planets);
  const totals = planetTotals(details.planets);
  const counts = usePlanetCounter()(details);
  const fixed = counts.planets !== null && !isRanged(counts.planets) ? counts.planets.min : null;
  const shown = all ? blocks : blocks.slice(0, LIST_LIMIT);
  const summary: ReactNode =
    fixed !== null ? undefined : counts.planets === null ? (
      <Unknown>from a script</Unknown>
    ) : (
      <Rolled>{rangeWords(counts.planets)}</Rolled>
    );
  const total = [
    planetsText(counts),
    ...moonsAndAsteroids(counts),
    `${totals.colonies} colonies`,
    totals.preFtl > 0 ? `${totals.preFtl} pre-FTL` : null,
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
      count={fixed ?? undefined}
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
                {total}
                <SizeAndPops size={null} pops={totals.pops} />
              </span>
              <span className="l3">
                <Pills rows={resourceRows(details, icons)} />
              </span>
            </span>
          </div>
          {shown.map(({ body, count, moons }) => (
            <PlanetRow
              key={body.id}
              planet={body}
              details={details}
              editHint={bodyEditHint(body.class, bodies, classes, starClasses)}
              count={count}
              moons={moons}
            />
          ))}
          {!all && blocks.length > LIST_LIMIT && (
            <MoreButton count={blocks.length - LIST_LIMIT} onClick={() => setAll(true)} />
          )}
          {details.spawn?.from_script != null && (
            <div className="muted ins-hint">{everyBodyFrom(details.spawn.from_script)}</div>
          )}
        </>
      )}
    </Section>
  );
}
