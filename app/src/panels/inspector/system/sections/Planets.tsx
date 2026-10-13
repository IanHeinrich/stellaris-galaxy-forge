import { Fragment, useState, type MouseEvent, type ReactNode } from "react";
import type { CountRange } from "../../../../generated/CountRange";
import type { PlanetSummary } from "../../../../generated/PlanetSummary";
import type { SystemDetails } from "../../../../generated/SystemDetails";
import { nameSpan, type GivenName } from "../../../../lib/details/spawnNames";
import { boundsText, isUnrolledClass } from "../../../../lib/details/labels";
import { resourceRows } from "../../../../lib/details/resources";
import { copiesValue, planetsSummaryValue, rowLabel } from "../../../../lib/details/scenarioValues";
import { isStar } from "../../../../lib/details/starBody";
import { bodyEditHint } from "../../../../lib/details/planetEdits";
import {
  blockCountTitle,
  blockNoun,
  bodyBlocks,
  moonsEach,
} from "../../../../lib/details/bodyBlocks";
import {
  countWords,
  EVERY_BODY_FROM,
  sharedScriptHint,
  isAsteroidClass,
  isRanged,
  moonsAndAsteroids,
  neverLine,
  neverSpawns,
  PLANETS_FROM_SCRIPT,
  type PlanetCounts,
} from "../../../../lib/details/spawnFacts";
import { useDetailsStore } from "../../../../store/detailsStore";
import { useCanEdit, useFileSessionStore } from "../../../../store/fileSessionStore";
import { useGameDataStore } from "../../../../store/gameDataStore";
import { bodyEntry, useInspectorStore } from "../../../../store/inspectorStore";
import { useMapChromeStore } from "../../../../store/mapChromeStore";
import { canEnterSystem, useSceneStore, useSceneSystem } from "../../../../store/sceneStore";
import { Icon } from "../../../parts";
import { DrillRow, Empty, MoreButton, Section, Swatch } from "../../parts";
import { Hinted, NeverPlaced, StateValue } from "../../states";
import { BodyChips } from "../../entity/BodyChips";
import { useGivenNames } from "../../entity/useBodyName";
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

function Pops({ pops }: { pops: number }) {
  return (
    <span className="pops">
      <Icon className="gi" keys={[POP_ICON_KEY]} glyph="⚇" />
      {formatPops(pops)}
    </span>
  );
}

function SizeAndPops({ size, pops }: { size: string | number | null; pops: number }) {
  return (
    <>
      {size !== null && <PlanetSize size={size} />}
      {pops > 0 && <Pops pops={pops} />}
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

/** The count at the right of a block's row, rolled where the game draws it, with its sentence in its card. */
function BlockCount({
  count,
  moon,
  asteroid,
}: {
  count: CountRange;
  moon: boolean;
  asteroid: boolean;
}) {
  return (
    <Hinted label="Copies" hint={blockCountTitle(count, moon, asteroid)} focusable={false}>
      <StateValue className="ins-block-count" value={copiesValue(count)} />
    </Hinted>
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
  given,
  span,
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
  /** The name the game gives a scenario body, where it can be told. */
  given?: GivenName;
  /** The names from the first copy of its block to the last, where the row stands for several. */
  span?: string;
}) {
  const icons = useDetailsStore((s) => s.resourceIcons);
  const classes = useGameDataStore((s) => s.planetClasses);
  const names = useGameDataStore((s) => s.names);
  const open = useInspectorStore((s) => s.open);
  const enterable = useFileSessionStore(canEnterSystem);
  const sprite = classes.get(planet.class)?.icon_sprite;
  const rows = resourceRows({ ...details, resources: planet.deposits }, icons);
  const wide = rows.length > INLINE_RESOURCES;
  const label = rowLabel(planet, given, count, span, { names, planetClasses: classes });
  const { name, described } = label;
  const size = planet.layout?.size ? boundsText(planet.layout.size) : planet.size;
  const spawn = planet.spawn;
  const asteroid = isAsteroidClass(planet.class, classes);
  const never = count !== null ? count.max === 0 : neverSpawns(spawn);
  const parentNever =
    never && details.planets.some((p) => p.id === planet.parent && neverSpawns(p.spawn));
  const countMark = never ? (
    <NeverPlaced hint={neverLine(blockNoun(planet.moon, asteroid, true), parentNever)} />
  ) : count === null ? null : (
    <BlockCount count={count} moon={planet.moon} asteroid={asteroid} />
  );
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
          <StateValue value={label.title} />
          <BodyChips body={planet} />
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
              label.class !== null && <StateValue value={label.class} />,
              planet.moon && !flat && !isUnrolledClass(planet.class) && count === null && (
                <span>moon</span>
              ),
              size !== null && <PlanetSize size={size} />,
              planet.pops > 0 && <Pops pops={planet.pops} />,
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
  const planets = orderedPlanets(details.planets, (p) =>
    isStar(p, { planetClasses: classes, starClasses }),
  );
  const blocks = bodyBlocks(planets);
  const given = useGivenNames(details);
  const spanOf = (copies: readonly PlanetSummary[]): string | undefined => {
    const placed = copies.filter((c) => !neverSpawns(c.spawn));
    if (placed.length < 2) return undefined;
    const first = given.get(placed[0].id);
    const last = given.get(placed[placed.length - 1].id);
    return first === undefined || last === undefined ? undefined : nameSpan(first, last);
  };
  const totals = planetTotals(details.planets);
  const counts = usePlanetCounter()(details);
  const fixed = counts.planets !== null && !isRanged(counts.planets) ? counts.planets.min : null;
  const shown = all ? blocks : blocks.slice(0, LIST_LIMIT);
  const summaryValue = planetsSummaryValue(counts);
  const summary = summaryValue === null ? undefined : <StateValue value={summaryValue} />;
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
        Show in system view
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
          {shown.map(({ body, copies, count, moons }) => (
            <PlanetRow
              key={body.id}
              planet={body}
              details={details}
              editHint={bodyEditHint(body.class, bodies, classes, starClasses)}
              count={count}
              moons={moons}
              given={given.get(body.id)}
              span={spanOf(copies)}
            />
          ))}
          {!all && blocks.length > LIST_LIMIT && (
            <MoreButton count={blocks.length - LIST_LIMIT} onClick={() => setAll(true)} />
          )}
          {details.spawn?.from_script != null && (
            <div className="muted ins-hint">
              <Hinted label="Shared script" hint={sharedScriptHint(details.spawn.from_script)}>
                {EVERY_BODY_FROM}
              </Hinted>
            </div>
          )}
        </>
      )}
    </Section>
  );
}
