import { type ReactNode } from "react";
import type { BodySpawn } from "../../../generated/BodySpawn";
import type { ClassPool } from "../../../generated/ClassPool";
import type { SpawnStar } from "../../../generated/SpawnStar";
import { planetTint } from "../../../lib/details/icons";
import { classValue } from "../../../lib/details/scenarioValues";
import { oddsRows } from "../../../lib/details/oddsBars";
import { readableTint } from "../../../lib/visual/color";
import {
  ANY_CLASS,
  classFitHint,
  classListSource,
  classRollsFailed,
  ifItRolls,
  LIST_ORBIT_HINT,
  offeredAsks,
  randomDrawHint,
  starListSource,
  unknownClassWhy,
  CHANGED_BY_EFFECT,
} from "../../../lib/details/spawnFacts";
import { useGameDataStore } from "../../../store/gameDataStore";
import { Hinted, HintedRow, StateValue, Why } from "../states";
import { PlanetIcon } from "../PlanetIcon";
import { useStarOdds } from "../system/sections/scenario/useStarOdds";
import type { BodyRead } from "./bodySources";
import { OddsList, type Press, type ShownOdds } from "./OddsBar";
import { classDrawFit, type ClassList } from "../../../lib/details/classList";
import { useClassList } from "./useClassList";
import type { ClassPreview } from "./useClassPreview";

/** The most classes listed a row each where none of their odds are known; more show as icons. */
const MOST_CLASS_ROWS = 4;

/** One class a body's class can be, as its list shows it, and the class its rolls are read as. */
interface ClassChoice extends ShownOdds {
  /** The class the picker reads what the body rolls as; `null` where it can't be picked. */
  ask: string | null;
}

/** A class list that picks a class: which one is picked, how to pick another, and why its rolls failed. */
type ClassPick = Pick<ClassPreview, "picked" | "pick" | "error">;

/**
 * The classes a body's class can be: a strip of icons, each named in its card, or an odds list.
 * With `pick` and more than one class to pick, each is a toggle after an Any that unpicks them,
 * and the line under it names the class picked.
 */
function ClassChoices({
  choices,
  strip,
  pick,
}: {
  choices: readonly ClassChoice[];
  strip: boolean;
  pick: ClassPick | null;
}) {
  const offered = pick !== null && offeredAsks(choices.map((c) => c.ask)).length > 0 ? pick : null;
  const any: Press | undefined =
    offered === null
      ? undefined
      : { pressed: offered.picked === null, onPress: () => offered.pick(null) };
  const picked = offered?.picked ?? null;
  const pickedChoice = picked === null ? undefined : choices.find((c) => c.ask === picked);
  const pickedName = picked === null ? null : (pickedChoice?.name ?? picked);
  const pressOf = ({ row, ask }: ClassChoice): Press | undefined =>
    offered === null || ask === null
      ? undefined
      : { pressed: pickedChoice?.row.key === row.key, onPress: () => offered.pick(ask) };
  return (
    <Why>
      {strip ? (
        <span className="pl-class-strip">
          {any !== undefined && (
            <button
              type="button"
              className="pl-class-pick pl-class-any"
              aria-pressed={any.pressed}
              onClick={any.onPress}
            >
              {ANY_CLASS}
            </button>
          )}
          {choices.map((choice) => (
            <Hinted
              key={choice.row.key}
              label={choice.name}
              hint={<span className="mono">{choice.row.key}</span>}
              press={pressOf(choice)}
            >
              <span role="img" aria-label={choice.name}>
                {choice.icon}
              </span>
            </Hinted>
          ))}
        </span>
      ) : (
        <OddsList
          lead={any === undefined ? undefined : { name: ANY_CLASS, press: any }}
          rows={choices.map((choice) => ({ ...choice, press: pressOf(choice) }))}
        />
      )}
      {pickedName !== null && <div className="muted ins-hint">{ifItRolls(pickedName)}</div>}
      {pickedName !== null && offered?.error != null && (
        <div className="ins-warn">
          <Hinted label={pickedName} hint={offered.error}>
            {classRollsFailed(pickedName)}
          </Hinted>
        </div>
      )}
    </Why>
  );
}

/**
 * Planet classes a draw can give, as an odds list: each class's icon and name, a bar and its share
 * where known, classes that show under one name as one. More than a few classes with no odds known
 * show as a strip of icons, each named in its card.
 */
function PlanetClassList({
  list,
  pick,
}: {
  list: Extract<ClassList, { kind: "planets" }>;
  pick: ClassPick | null;
}) {
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const { rows: merged, asks } = list;
  const strip = merged.length > MOST_CLASS_ROWS && merged.every((o) => o.chance === null);
  const choices = oddsRows(
    merged.map((o) => ({ key: o.key, share: o.chance })),
    (key) => readableTint(planetTint(key)),
  ).map((row, i) => ({
    row,
    name: merged[i].name,
    icon: <PlanetIcon planetClass={row.key} sprite={planetClasses.get(row.key)?.icon_sprite} />,
    ask: asks[i],
  }));
  return <ClassChoices choices={choices} strip={strip} pick={pick} />;
}

/** The star classes a star list draws a star body from, each picked as its star's planet class. */
function StarClassList({
  list,
  pick,
}: {
  list: Extract<ClassList, { kind: "stars" }>;
  pick: ClassPick | null;
}) {
  const choices = useStarOdds(list.star).map((odds, i) => ({ ...odds, ask: list.asks[i] }));
  return <ClassChoices choices={choices} strip={false} pick={pick} />;
}

/**
 * What the Class row's card says decides the class: the initializer's effect, why it can't be
 * told, or what it is drawn from, `listed`'s star list where one draws it.
 */
function classHint(
  spawn: BodySpawn,
  listed: Extract<SpawnStar, { state: "rolled" }> | null,
  read: BodyRead,
): ReactNode {
  if (spawn.changed_class !== null) return CHANGED_BY_EFFECT;
  const cls = spawn.class;
  if (cls.state === "unknown") return unknownClassWhy(cls.reason, cls.written);
  if (cls.state === "fixed") return null;
  return rolledClassHint(cls.pool, listed, read);
}

/** What a rolled class's card says it is drawn from: `listed`'s star list, or its pool. */
function rolledClassHint(
  pool: ClassPool,
  listed: Extract<SpawnStar, { state: "rolled" }> | null,
  read: BodyRead,
): ReactNode {
  if (listed !== null) return starListSource(listed.list);
  if (pool.kind === "planet_list") {
    return (
      <>
        <span className="ins-set-by">{classListSource(pool.list)}</span>
        <span className="ins-set-by">{LIST_ORBIT_HINT}</span>
      </>
    );
  }
  if (pool.kind !== "random") return null;
  const { orbitRanged, starRolled, exact } = classDrawFit(read.details, read.summary);
  return (
    <>
      <span className="ins-set-by">{randomDrawHint(pool.draw)}</span>
      {pool.at_orbit !== undefined && !exact && (
        <span className="ins-set-by">{classFitHint(orbitRanged, starRolled)}</span>
      )}
    </>
  );
}

/** The Class row, with what decides it in its card, and the list of what it can be under it. */
export function ClassRow({
  spawn,
  read,
  pick,
}: {
  spawn: BodySpawn;
  read: BodyRead;
  pick: ClassPick;
}) {
  const names = useGameDataStore((s) => s.names);
  const list = useClassList(read);
  const listed = list?.kind === "stars" ? list.star : null;
  const value = classValue(spawn, names, read.summary.moon, listed?.members.length ?? null);
  return (
    <>
      <HintedRow label="Class" hint={classHint(spawn, listed, read)}>
        <StateValue value={value} />
      </HintedRow>
      {list?.kind === "stars" && <StarClassList list={list} pick={pick} />}
      {list?.kind === "planets" && <PlanetClassList list={list} pick={pick} />}
    </>
  );
}
