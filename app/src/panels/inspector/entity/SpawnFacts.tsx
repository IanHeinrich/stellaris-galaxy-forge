import { useEffect, type ReactNode } from "react";
import type { BodySpawn } from "../../../generated/BodySpawn";
import type { SpawnStar } from "../../../generated/SpawnStar";
import type { SpawnPool } from "../../../generated/SpawnPool";
import { planetTint } from "../../../lib/details/icons";
import { bodyClassName, bodyName } from "../../../lib/details/labels";
import { NEUTRAL_BAR, oddsRows, readableTint } from "../../../lib/details/oddsBars";
import { modelLabel } from "../../../lib/details/planetModel";
import {
  ANY_CLASS,
  bodyFrom,
  bodyNoun,
  CAN_ROLL_TITLE,
  CLASS_DECIDED,
  CLASS_SUITED,
  classDraw,
  classFitHint,
  classListSource,
  classOdds,
  classSuitedHint,
  copyFacts,
  depositsWithClass,
  featuresTail,
  featuresWithClass,
  ifItRolls,
  LIST_ORBIT_HINT,
  mergedByName,
  NAME_RANDOM,
  NAME_RANDOM_WHY,
  neverLine,
  neverSpawns,
  poolPicks,
  poolTitle,
  type PoolPick,
  randomDrawHint,
  RING_ROLLED,
  ringWords,
  setsSize,
  sharedScriptHint,
  shownWithItsRow,
  starClassesWords,
  starListSource,
  type StarOdds,
  STOPPED_LABEL,
  stoppedFacts,
  unknownClassWhy,
  valueSources,
} from "../../../lib/details/spawnFacts";
import {
  NAMED_AFTER_SYSTEM,
  namedAfterParent,
  parentUnnamedWhy,
  rolledNameWhy,
  SYSTEM_UNNAMED_WHY,
} from "../../../lib/details/spawnNames";
import { depositKinds, depositKindsTail } from "../../../lib/details/depositBars";
import { templateName } from "../../../lib/names";
import { capitalised } from "../../../lib/text";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { Group, Properties, PropertyRow, Section } from "../parts";
import { OtherLinesGroup, ScriptGroup } from "../ScriptGroup";
import {
  DependsOnClass,
  Hinted,
  HintedRow,
  Rolled,
  SetByLines,
  SetByRow,
  StoppedTag,
  Unknown,
  Why,
} from "../states";
import { PlanetIcon, PlanetSize } from "../system/sections/bodies";
import { useStarOdds } from "../system/sections/scenario/useStarOdds";
import { useInitializerFile } from "../system/sections/scenario/useInitializerFile";
import { bodySize, rangeText } from "./bodyFields";
import type { BodyRead } from "./bodySources";
import { DepositKindsList } from "./DepositPoolBars";
import { OddsList, type Press, type ShownOdds } from "./OddsBar";
import type { PlanetSectionProps } from "./planetSection";
import { useGivenNames } from "./useBodyName";
import type { ClassPreview } from "./useClassPreview";
import { useFeatureNamer } from "./useFeatureNamer";

/** What the initializer's effect does to a value the block states. */
const CHANGED_BY_EFFECT = "The initializer changes it when a new game starts.";

type RolledStar = Extract<SpawnStar, { state: "rolled" }>;

/** The most classes listed a row each where none of their odds are known; more show as icons. */
const MOST_CLASS_ROWS = 4;

/** One class a body's class can be, as its list shows it, and the class its rolls are read as. */
interface ClassChoice extends ShownOdds {
  /** The class the picker reads what the body rolls as; `null` where it can't be picked. */
  ask: string | null;
}

/** A class list that picks a class: which one is picked, how to pick another, and why its rolls failed. */
type ClassPick = Pick<ClassPreview, "picked" | "pick" | "error">;

/** The toggle a choice is in a picker; none where the list picks nothing or the choice can't be picked. */
function pressOf(pick: ClassPick | null, ask: string | null): Press | undefined {
  if (pick === null || ask === null) return undefined;
  return { pressed: pick.picked === ask, onPress: () => pick.pick(ask) };
}

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
  const offered = pick !== null && choices.filter((c) => c.ask !== null).length > 1 ? pick : null;
  const any: Press | undefined =
    offered === null
      ? undefined
      : { pressed: offered.picked === null, onPress: () => offered.pick(null) };
  const picked = offered?.picked ?? null;
  const pickedName =
    picked === null ? null : (choices.find((c) => c.ask === picked)?.name ?? picked);
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
          {choices.map(({ row, name, icon, ask }) => {
            const press = pressOf(offered, ask);
            const shown = (
              <Hinted
                key={row.key}
                label={name}
                hint={<span className="mono">{row.key}</span>}
                focusable={press === undefined}
              >
                <span role="img" aria-label={name}>
                  {icon}
                </span>
              </Hinted>
            );
            return press === undefined ? (
              shown
            ) : (
              <button
                key={row.key}
                type="button"
                className="pl-class-pick"
                aria-pressed={press.pressed}
                onClick={press.onPress}
              >
                {shown}
              </button>
            );
          })}
        </span>
      ) : (
        <OddsList
          lead={any === undefined ? undefined : { name: ANY_CLASS, press: any }}
          rows={choices.map((choice) => ({ ...choice, press: pressOf(offered, choice.ask) }))}
        />
      )}
      {pickedName !== null && <div className="muted ins-hint">{ifItRolls(pickedName)}</div>}
      {offered?.error != null && <div className="ins-warn">{offered.error}</div>}
    </Why>
  );
}

/**
 * Planet classes a draw can give, as an odds list: each class's icon and name, a bar and its share
 * where known, classes that show under one name as one. More than a few classes with no odds known
 * show as a strip of icons, each named in its card.
 */
function ClassList({
  odds,
  moon,
  pick,
}: {
  odds: readonly StarOdds[];
  moon: boolean;
  pick: ClassPick | null;
}) {
  const names = useGameDataStore((s) => s.names);
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const merged = mergedByName(
    odds.map((o) => ({ key: o.key, chance: o.share })),
    (key) => bodyClassName(key, names, moon),
  );
  const strip = merged.length > MOST_CLASS_ROWS && merged.every((o) => o.chance === null);
  const choices = oddsRows(
    merged.map((o) => ({ key: o.key, share: o.chance })),
    (key) => readableTint(planetTint(key)),
  ).map((row, i) => ({
    row,
    name: merged[i].name,
    icon: <PlanetIcon planetClass={row.key} sprite={planetClasses.get(row.key)?.icon_sprite} />,
    ask: row.key,
  }));
  return <ClassChoices choices={choices} strip={strip} pick={pick} />;
}

/** The star classes a star list draws a star body from, each picked as its star's planet class. */
function StarClassList({ star, pick }: { star: RolledStar; pick: ClassPick | null }) {
  const starClasses = useGameDataStore((s) => s.starClasses);
  const choices = useStarOdds(star).map((odds) => ({
    ...odds,
    ask: starClasses.get(odds.row.key)?.planet_keys[0] ?? null,
  }));
  return <ClassChoices choices={choices} strip={false} pick={pick} />;
}

/** The Class row, with what decides it in its card, and the list of what it can be under it. */
function ClassRow({ spawn, read, pick }: { spawn: BodySpawn; read: BodyRead; pick: ClassPick }) {
  const names = useGameDataStore((s) => s.names);
  const { summary, details } = read;
  if (spawn.changed_class !== null) {
    return (
      <HintedRow label="Class" hint={CHANGED_BY_EFFECT}>
        {bodyClassName(spawn.changed_class, names, summary.moon)}
      </HintedRow>
    );
  }
  const cls = spawn.class;
  switch (cls.state) {
    case "fixed":
      return (
        <PropertyRow label="Class">{bodyClassName(cls.class, names, summary.moon)}</PropertyRow>
      );
    case "unknown":
      return (
        <HintedRow label="Class" hint={unknownClassWhy(cls.reason, cls.written)}>
          <Unknown>{CLASS_DECIDED}</Unknown>
        </HintedRow>
      );
    case "rolled": {
      const pool = cls.pool;
      const star = details.spawn?.star;
      const listed = pool.kind === "star_list" && star?.state === "rolled" ? star : null;
      const orbitRanged =
        summary.layout?.orbit == null || summary.layout.orbit.min !== summary.layout.orbit.max;
      const starRolled = star?.state !== "fixed";
      const exact = !orbitRanged && !starRolled;
      const hint =
        listed !== null ? (
          starListSource(listed.list)
        ) : pool.kind === "planet_list" ? (
          <>
            <span className="ins-set-by">{classListSource(pool.list)}</span>
            <span className="ins-set-by">{LIST_ORBIT_HINT}</span>
          </>
        ) : pool.kind === "random" ? (
          <>
            <span className="ins-set-by">{randomDrawHint(pool.draw)}</span>
            {pool.at_orbit !== undefined && !exact && (
              <span className="ins-set-by">{classFitHint(orbitRanged, starRolled)}</span>
            )}
          </>
        ) : null;
      return (
        <>
          <HintedRow label="Class" hint={hint}>
            <Rolled>
              {listed === null
                ? capitalised(classDraw(pool))
                : starClassesWords(listed.members.length)}
            </Rolled>
          </HintedRow>
          {listed !== null && <StarClassList star={listed} pick={pick} />}
          {pool.kind === "random" && pool.at_orbit !== undefined && pool.at_orbit.length > 0 && (
            <ClassList
              odds={classOdds(pool.at_orbit).map((o) => (exact ? o : { ...o, share: null }))}
              moon={summary.moon}
              pick={pick}
            />
          )}
          {pool.kind === "planet_list" && (
            <ClassList
              odds={pool.members.map((m) => ({ key: m.key, share: null }))}
              moon={summary.moon}
              pick={pick}
            />
          )}
        </>
      );
    }
  }
}

/** The Name row: the name the game gives the body, with how it numbers it in its card. */
function NameRow({ read, spawn, noun }: { read: BodyRead; spawn: BodySpawn; noun: string }) {
  const names = useGameDataStore((s) => s.names);
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const { summary } = read;
  const given = useGivenNames(read.details).get(summary.id);
  const stated = spawn.name ?? (templateName(summary) === "" ? null : bodyName(summary, names));
  const naming = spawn.naming;
  if (given !== undefined) {
    return (
      <HintedRow label="Name" hint={given.rolled ? rolledNameWhy(given, noun) : null}>
        {given.rolled ? <Rolled>{given.text}</Rolled> : given.text}
      </HintedRow>
    );
  }
  if (naming?.state === "template" && stated === null) {
    const parent =
      naming.parent === null ? undefined : read.details.planets.find((p) => p.id === naming.parent);
    const parentNoun = parent === undefined ? "planet" : bodyNoun(parent, planetClasses);
    return naming.parent === null ? (
      <HintedRow label="Name" hint={SYSTEM_UNNAMED_WHY}>
        <Unknown>{NAMED_AFTER_SYSTEM}</Unknown>
      </HintedRow>
    ) : (
      <HintedRow label="Name" hint={parentUnnamedWhy(parentNoun)}>
        <Unknown>{namedAfterParent(parentNoun)}</Unknown>
      </HintedRow>
    );
  }
  return (
    <HintedRow label="Name" hint={stated === null ? NAME_RANDOM_WHY : null}>
      {stated ?? <Rolled>{NAME_RANDOM}</Rolled>}
    </HintedRow>
  );
}

/** The Model row of a model the initializer names: its name as the save's Model field shows it, its key in the card. */
function ModelRow({ entity }: { entity: string }) {
  const ready = useGameDataStore((s) => s.status === "ready");
  const models = useGameDataStore((s) => s.planetModels);
  useEffect(() => void useGameDataStore.getState().loadPlanetModels(), [ready]);
  return (
    <HintedRow label="Model" hint={<span className="mono">{entity}</span>}>
      {modelLabel(models ?? [], entity)}
    </HintedRow>
  );
}

/** The Size row, with what sets it or changes it in its card. */
function SizeRow({ read, spawn, noun }: { read: BodyRead; spawn: BodySpawn; noun: string }) {
  const { summary } = read;
  const size = bodySize(summary);
  const sources = valueSources(
    { inline_scripts: [], variables: spawn.variables.filter((v) => setsSize(v.key)) },
    summary.moon,
  );
  const changed = spawn.changed_size !== null;
  const suited = !changed && size === null;
  const hint =
    sources.length === 0 && !changed && !suited ? null : (
      <>
        {changed && <span className="ins-set-by">{CHANGED_BY_EFFECT}</span>}
        {suited && <span className="ins-set-by">{classSuitedHint(noun)}</span>}
        <SetByLines sources={sources} />
      </>
    );
  return (
    <HintedRow label="Size" hint={hint}>
      {spawn.changed_size !== null ? (
        <PlanetSize size={spawn.changed_size} />
      ) : size === null ? (
        <Rolled>{CLASS_SUITED}</Rolled>
      ) : size.min === size.max ? (
        <PlanetSize size={rangeText(size)} />
      ) : (
        <Rolled>
          <PlanetSize size={rangeText(size)} />
        </Rolled>
      )}
    </HintedRow>
  );
}

/** A row whose value only the class the body rolls decides, with why in its card. */
function ClassSuitedRow({ label, noun }: { label: string; noun: string }) {
  return (
    <HintedRow label={label} hint={classSuitedHint(noun)}>
      <Rolled>{CLASS_SUITED}</Rolled>
    </HintedRow>
  );
}

/** A pool's picks, or none where the install can't tell them. */
function picksOf(pool: SpawnPool | undefined): PoolPick[] {
  return pool?.state === "rolled" ? poolPicks(pool) : [];
}

/** Whether a pool holds nothing the roll can give, so a body has no row for it. */
function emptyPool(pool: SpawnPool | undefined): boolean {
  return pool?.state === "rolled" && pool.entries.length === 0;
}

/** The Deposits row of deposits rolled to suit the class, and what they can be folded under it. */
function ClassSuitedDeposits({ spawn, noun }: { spawn: BodySpawn; noun: string }) {
  const views = usePlanetDataStore((s) => s.depositTypes);
  const picks = picksOf(spawn.rolled_deposits);
  const kinds = depositKinds(picks, views);
  if (emptyPool(spawn.rolled_deposits)) return null;
  return (
    <>
      <ClassSuitedRow label="Deposits" noun={noun} />
      {picks.length > 0 && (
        <Group
          id="planet.deposits.roll"
          title={CAN_ROLL_TITLE}
          tail={depositKindsTail(kinds)}
          folded
        >
          <DepositKindsList kinds={kinds} />
        </Group>
      )}
    </>
  );
}

/** The Planet features row of features rolled to suit the class, and what they can be folded under it. */
function ClassSuitedFeatures({ spawn, noun }: { spawn: BodySpawn; noun: string }) {
  const named = useFeatureNamer();
  const picks = picksOf(spawn.rolled_features);
  if (emptyPool(spawn.rolled_features)) return null;
  return (
    <>
      <ClassSuitedRow label="Planet features" noun={noun} />
      {picks.length > 0 && (
        <Group
          id="planet.features.roll"
          title={CAN_ROLL_TITLE}
          tail={featuresTail(mergedByName(picks, named).length)}
          folded
        >
          <FeaturePool picks={picks} />
        </Group>
      )}
    </>
  );
}

/** The Ring row: stated, a chance, or left to the class the body rolls. */
function RingRow({ read, spawn, noun }: { read: BodyRead; spawn: BodySpawn; noun: string }) {
  const ring = spawn.ring;
  if (ring?.state === "unknown") return <ClassSuitedRow label="Ring" noun={noun} />;
  return (
    <PropertyRow label="Ring">
      {ring === undefined ? (
        read.summary.ring === null ? (
          <Rolled>{RING_ROLLED}</Rolled>
        ) : read.summary.ring ? (
          "Yes"
        ) : (
          "No"
        )
      ) : ring.state === "rolled" ? (
        <Rolled>{ringWords(ring)}</Rolled>
      ) : (
        ringWords(ring)
      )}
    </PropertyRow>
  );
}

/** What the class picked decides, dimmed while what the body rolls as that class is read. */
export function ClassDependent({ busy, children }: { busy: boolean; children: ReactNode }) {
  if (!busy) return children;
  return (
    <div className="ins-busy" aria-busy="true">
      {children}
    </div>
  );
}

/**
 * A scenario body's facts in the save page's rows: its name, class, size, ring and model, its
 * deposits and planet features where only its class decides them, and what the initializer stops
 * on it. Explanations show in each value's card. `read` and `spawn` are the body as the class
 * `preview` picks.
 */
export function SpawnProperties({
  read,
  spawn,
  star,
  preview,
}: {
  read: BodyRead;
  spawn: BodySpawn;
  star: boolean;
  preview: ClassPreview;
}) {
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const { summary } = read;
  const noun = bodyNoun(summary, planetClasses);
  const placed = !neverSpawns(spawn);
  const stopped = stoppedFacts(spawn, read.rows.modifiers.length, noun);
  return (
    <Properties>
      <NameRow read={read} spawn={spawn} noun={noun} />
      <ClassRow spawn={spawn} read={read} pick={preview} />
      <ClassDependent busy={preview.busy}>
        <SizeRow read={read} spawn={spawn} noun={noun} />
        {!star && placed && <RingRow read={read} spawn={spawn} noun={noun} />}
        {!star && spawn.entity !== null && <ModelRow entity={spawn.entity} />}
        {!star && placed && spawn.entity === null && <ClassSuitedRow label="Model" noun={noun} />}
        {placed && depositsWithClass(spawn, read.rows.deposits.count) && (
          <ClassSuitedDeposits spawn={spawn} noun={noun} />
        )}
        {placed && featuresWithClass(spawn, read.rows.modifiers.length) && (
          <ClassSuitedFeatures spawn={spawn} noun={noun} />
        )}
      </ClassDependent>
      {stopped.length > 0 && (
        <HintedRow
          label={STOPPED_LABEL}
          hint={stopped.map((fact) => (
            <span key={fact.tag} className="ins-set-by">
              {fact.line}
            </span>
          ))}
        >
          <span className="ins-tags">
            {stopped.map((fact) => (
              <StoppedTag key={fact.tag}>{fact.tag}</StoppedTag>
            ))}
          </span>
        </HintedRow>
      )}
    </Properties>
  );
}

/**
 * Under a scenario body's head: its place among the bodies its block places, and the inline script
 * it comes from.
 */
export function SpawnHeadNotes({ read }: { read: BodyRead }) {
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const { summary } = read;
  const spawn = summary.spawn;
  if (spawn === undefined) return null;
  const noun = bodyNoun(summary, planetClasses);
  const parent = read.details.planets.find((p) => p.id === summary.parent);
  const copy = neverSpawns(spawn) ? null : copyFacts(spawn, noun);
  return (
    <>
      {neverSpawns(spawn) && (
        <div className="muted ins-hint">{neverLine(noun, neverSpawns(parent?.spawn))}</div>
      )}
      {copy !== null && (
        <div className="muted ins-hint">
          <Hinted label="Copies" hint={copy.hint}>
            {copy.line}
          </Hinted>
        </div>
      )}
      {spawn.from_script !== null && (
        <div className="muted ins-hint">
          <Hinted label="Shared script" hint={sharedScriptHint(spawn.from_script)}>
            {bodyFrom(noun)}
          </Hinted>
        </div>
      )}
    </>
  );
}

/** The flags a scenario body's initializer sets on it. */
export function BodyFlags({ read }: PlanetSectionProps) {
  const flags = read.summary.spawn?.flags ?? [];
  if (flags.length === 0) return null;
  return (
    <Section id="planet.flags" title="Flags" count={flags.length}>
      <div className="ins-flags mono">
        {flags.map((flag) => (
          <div key={flag}>{flag}</div>
        ))}
      </div>
    </Section>
  );
}

/**
 * What a scenario body's initializer says that a save has no field for: whether an empire starts
 * on it, the values an `@variable` sets, and the keys and script Galaxy Forge keeps as written.
 */
export function BodyInitializer({ read }: PlanetSectionProps) {
  const system = useGalaxyStore((s) => s.systems.get(read.details.id));
  const file = useInitializerFile(system?.initializer ?? "");
  const spawn = read.summary.spawn;
  if (spawn === undefined) return null;
  const orbitStep = read.summary.layout?.orbit_step != null;
  const variables = spawn.variables.filter((v) => !shownWithItsRow(v.key, orbitStep));
  const from = valueSources({ inline_scripts: [], variables }, read.summary.moon);
  const shown = from.length > 0 || spawn.other_keys.length > 0 || spawn.script.length > 0;
  if (!shown) return null;
  return (
    <Section id="planet.initializer" title="Initializer">
      <div className="ins-init">
        {from.length > 0 && (
          <Properties>
            {from.map((source) => (
              <SetByRow key={`${source.label}-${source.name}`} source={source} />
            ))}
          </Properties>
        )}
        <ScriptGroup id="planet.initializer.script" statements={spawn.script} file={file} />
        <OtherLinesGroup id="planet.initializer.other" statements={spawn.other_keys} file={file} />
      </div>
    </Section>
  );
}

/** The most feature names listed where none of their odds are known; the rest show as a count. */
const MOST_FEATURE_NAMES = 8;

/**
 * Planet features the roll can give, each name once and likeliest first: a bar for each whose
 * chance is known, or where none is, a line saying the class decides and the names in one line.
 * More than a few names are cut to a count that has the whole list in its card.
 */
export function FeaturePool({ picks }: { picks: readonly PoolPick[] }) {
  const named = useFeatureNamer();
  const merged = mergedByName(picks, named);
  if (merged.every((pick) => pick.chance === null)) {
    const names = merged.map((pick) => pick.name);
    const cut = names.length - MOST_FEATURE_NAMES;
    return (
      <>
        <DependsOnClass />
        <div className="pl-pool-names">
          {cut > 0 ? (
            <>
              {names.slice(0, MOST_FEATURE_NAMES).join(", ")},{" "}
              <Hinted label="All planet features" hint={names.join(", ")}>
                +{cut} more
              </Hinted>
            </>
          ) : (
            names.join(", ")
          )}
        </div>
      </>
    );
  }
  const rows = oddsRows(
    merged.map((p) => ({ key: p.key, share: p.chance })),
    () => NEUTRAL_BAR,
  );
  return <OddsList rows={rows.map((row, i) => ({ row, name: merged[i].name }))} />;
}

/**
 * After the rows a scenario body's initializer states, what its own roll can give it, likeliest
 * first: nothing where it rolls none, and why where the class it rolls decides. `body` shows the
 * picks, and `tail` counts them as they show.
 */
export function PoolLines({
  pool,
  stated,
  noun,
  tail,
  body,
}: {
  pool: SpawnPool | undefined;
  stated: number;
  /** What the page calls the body, for the cards. */
  noun: string;
  /** The line's tail after "Can roll ·". */
  tail: (picks: PoolPick[]) => string;
  body: (picks: PoolPick[]) => ReactNode;
}) {
  if (pool === undefined || pool.state === "fixed") return null;
  if (pool.state === "unknown") {
    return (
      <div className="pl-sub-head">
        <Hinted label={CLASS_SUITED} hint={classSuitedHint(noun)}>
          <Rolled>{CLASS_SUITED}</Rolled>
        </Hinted>
      </div>
    );
  }
  const picks = poolPicks(pool);
  if (picks.length === 0) return null;
  return (
    <>
      <div className="pl-sub-head">
        <Rolled />
        {poolTitle(stated, tail(picks))}
      </div>
      {body(picks)}
    </>
  );
}
