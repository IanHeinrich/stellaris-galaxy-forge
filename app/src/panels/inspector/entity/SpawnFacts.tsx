import type { BodySpawn } from "../../../generated/BodySpawn";
import type { PoolClass } from "../../../generated/PoolClass";
import type { SpawnPool } from "../../../generated/SpawnPool";
import type { SpawnStar } from "../../../generated/SpawnStar";
import { bodyClassName, bodyName } from "../../../lib/details/labels";
import {
  bodyNoun,
  bodyScriptHint,
  CLASS_DECIDED,
  classFitHint,
  DEPOSITS_UNKNOWN,
  bodyFrom,
  classOdds,
  LIST_ORBIT_HINT,
  neverLine,
  neverSpawns,
  ringWords,
  copyLine,
  isAsteroidClass,
  lineCount,
  MODEL_ROLLED,
  NAME_UNKNOWN,
  OTHER_KEYS_HINT,
  OTHER_KEYS_TITLE,
  percent,
  poolPicks,
  poolTitle,
  type PoolKind,
  rawText,
  RING_ROLLED,
  ROLLED_TITLE,
  rolledClassText,
  SCRIPT_TITLE,
  START_PLANET_HINT,
  starOdds,
  unknownClassWhy,
  valueSources,
} from "../../../lib/details/spawnFacts";
import {
  NAME_DRAWN_WHY,
  NAMED_AFTER_SYSTEM,
  namedAfterParent,
  parentUnnamedWhy,
  rolledNameWhy,
  SYSTEM_UNNAMED_WHY,
} from "../../../lib/details/spawnNames";
import { templateName } from "../../../lib/names";
import { counted, keyWords } from "../../../lib/text";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { ScriptSnippet } from "../../ScriptSnippet";
import { useNamed } from "../../useNamed";
import { Group, Properties, PropertyRow, Section } from "../parts";
import { Rolled, SetByRow, Unknown, Why } from "../states";
import { PlanetSize } from "../system/sections/bodies";
import { useInitializerFile } from "../system/sections/scenario/useInitializerFile";
import { bodySize, rangeText } from "./bodyFields";
import type { BodyRead } from "./bodySources";
import type { PlanetSectionProps } from "./planetSection";
import { useGivenNames } from "./useBodyName";

/** What the initializer's effect does to a value the block states. */
const CHANGED_BY_EFFECT = "The initializer changes it when the system is built.";

/** `G 24% · K 16%`: a star list's members with their odds, as the star's Class row lists them. */
function OddsLine({ star }: { star: Extract<SpawnStar, { state: "rolled" }> }) {
  const odds = starOdds(star.members);
  const named = useNamed(odds.map((o) => o.key));
  return (
    <Why>
      {odds
        .map((o) => (o.share === null ? named(o.key) : `${named(o.key)} ${percent(o.share)}`))
        .join(" · ")}
    </Why>
  );
}

/**
 * `Barren 30% · Toxic 20%`: the classes a random draw can give at the body's orbit, likeliest
 * first. The odds show only where the orbit is one value and the star is fixed; elsewhere the
 * classes are a union over every orbit and star, and a line says so.
 */
function ClassOddsLine({
  classes,
  moon,
  orbitRanged,
  starRolled,
}: {
  classes: PoolClass[];
  moon: boolean;
  orbitRanged: boolean;
  starRolled: boolean;
}) {
  const names = useGameDataStore((s) => s.names);
  const exact = !orbitRanged && !starRolled;
  return (
    <>
      <Why>
        <Rolled>
          {classOdds(classes)
            .map((o) => {
              const named = bodyClassName(o.key, names, moon);
              return o.share === null || !exact ? named : `${named} ${percent(o.share)}`;
            })
            .join(" · ")}
        </Rolled>
      </Why>
      {!exact && <Why>{classFitHint(orbitRanged, starRolled)}</Why>}
    </>
  );
}

/** The Class row: fixed, rolled from a pool, or decided in a way Galaxy Forge can't tell. */
function ClassRow({ spawn, read }: { spawn: BodySpawn; read: BodyRead }) {
  const names = useGameDataStore((s) => s.names);
  const { summary, details } = read;
  if (spawn.changed_class !== null) {
    return (
      <>
        <PropertyRow label="Class">{bodyClassName(spawn.changed_class, names)}</PropertyRow>
        <Why>{CHANGED_BY_EFFECT}</Why>
      </>
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
        <>
          <PropertyRow label="Class">
            <Unknown>{CLASS_DECIDED}</Unknown>
          </PropertyRow>
          <Why>{unknownClassWhy(cls.reason, cls.written)}</Why>
        </>
      );
    case "rolled": {
      const pool = cls.pool;
      const star = details.spawn?.star;
      const listed = pool.kind === "star_list" && star?.state === "rolled" ? star : null;
      return (
        <>
          <PropertyRow label="Class">
            <Rolled>
              {listed === null
                ? rolledClassText(pool)
                : `One of ${listed.members.length}, from ${listed.list}`}
            </Rolled>
          </PropertyRow>
          {listed !== null && <OddsLine star={listed} />}
          {pool.kind === "random" && pool.at_orbit !== undefined && pool.at_orbit.length > 0 && (
            <ClassOddsLine
              classes={pool.at_orbit}
              moon={summary.moon}
              orbitRanged={
                summary.layout?.orbit == null ||
                summary.layout.orbit.min !== summary.layout.orbit.max
              }
              starRolled={star?.state !== "fixed"}
            />
          )}
          {pool.kind === "planet_list" && (
            <>
              <Why>
                <Rolled>{pool.members.map((m) => bodyClassName(m.key, names)).join(" · ")}</Rolled>
              </Why>
              <Why>{LIST_ORBIT_HINT}</Why>
            </>
          )}
        </>
      );
    }
  }
}

/**
 * A scenario body's fixed facts in the save page's rows: its name, class, size, ring and model,
 * each fixed, rolled or unknown.
 */
export function SpawnProperties({
  read,
  spawn,
  star,
}: {
  read: BodyRead;
  spawn: BodySpawn;
  star: boolean;
}) {
  const names = useGameDataStore((s) => s.names);
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const { summary } = read;
  const given = useGivenNames(read.details).get(summary.id);
  const size = bodySize(summary);
  const stated = spawn.name ?? (templateName(summary) === "" ? null : bodyName(summary, names));
  const noun = isAsteroidClass(summary.class, planetClasses) ? "asteroid" : bodyNoun(summary);
  const naming = spawn.naming;
  const parent =
    naming?.state === "template" && naming.parent !== null
      ? read.details.planets.find((p) => p.id === naming.parent)
      : undefined;
  const parentNoun = parent === undefined ? "planet" : bodyNoun(parent);
  return (
    <Properties>
      {given !== undefined ? (
        <>
          <PropertyRow label="Name">
            {given.rolled ? <Rolled>{given.text}</Rolled> : given.text}
          </PropertyRow>
          {given.rolled && <Why>{rolledNameWhy(given, noun)}</Why>}
        </>
      ) : naming?.state === "template" && stated === null ? (
        naming.parent === null ? (
          <>
            <PropertyRow label="Name">
              <Unknown>{NAMED_AFTER_SYSTEM}</Unknown>
            </PropertyRow>
            <Why>{SYSTEM_UNNAMED_WHY}</Why>
          </>
        ) : (
          <>
            <PropertyRow label="Name">
              <Unknown>{namedAfterParent(parentNoun)}</Unknown>
            </PropertyRow>
            <Why>{parentUnnamedWhy(parentNoun)}</Why>
          </>
        )
      ) : (
        <>
          <PropertyRow label="Name">{stated ?? <Unknown>{NAME_UNKNOWN}</Unknown>}</PropertyRow>
          {stated === null && naming?.state === "unknown" && <Why>{NAME_DRAWN_WHY}</Why>}
        </>
      )}
      <ClassRow spawn={spawn} read={read} />
      {spawn.changed_size !== null ? (
        <>
          <PropertyRow label="Size">
            <PlanetSize size={spawn.changed_size} />
          </PropertyRow>
          <Why>{CHANGED_BY_EFFECT}</Why>
        </>
      ) : (
        <PropertyRow label="Size">
          {size === null ? (
            <Rolled>Rolled from its class's sizes</Rolled>
          ) : size.min === size.max ? (
            <PlanetSize size={rangeText(size)} />
          ) : (
            <Rolled>
              <PlanetSize size={rangeText(size)} />
            </Rolled>
          )}
        </PropertyRow>
      )}
      {!star && !neverSpawns(spawn) && (
        <PropertyRow label="Ring">
          {spawn.ring === undefined ? (
            summary.ring === null ? (
              <Rolled>{RING_ROLLED}</Rolled>
            ) : summary.ring ? (
              "Yes"
            ) : (
              "No"
            )
          ) : spawn.ring.state === "fixed" ? (
            ringWords(spawn.ring)
          ) : spawn.ring.state === "rolled" ? (
            <Rolled>{ringWords(spawn.ring)}</Rolled>
          ) : (
            <Unknown>{ringWords(spawn.ring)}</Unknown>
          )}
        </PropertyRow>
      )}
      {!star &&
        (spawn.entity === null ? (
          <PropertyRow label="Model">
            <Rolled>{MODEL_ROLLED}</Rolled>
          </PropertyRow>
        ) : (
          <PropertyRow label="Model" mono>
            {spawn.entity}
          </PropertyRow>
        ))}
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
  const noun = isAsteroidClass(summary.class, planetClasses) ? "asteroid" : bodyNoun(summary);
  const parent = read.details.planets.find((p) => p.id === summary.parent);
  const copy = neverSpawns(spawn)
    ? neverLine(noun, neverSpawns(parent?.spawn))
    : copyLine(spawn, noun);
  return (
    <>
      {copy !== null && <div className="muted ins-hint">{copy}</div>}
      {spawn.from_script !== null && (
        <div className="muted ins-hint">{bodyFrom(noun, spawn.from_script)}</div>
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
  const from = valueSources({ inline_scripts: [], variables: spawn.variables }, read.summary.moon);
  const rows = spawn.starting_planet || spawn.home_planet || from.length > 0;
  const shown = rows || spawn.other_keys.length > 0 || spawn.script.length > 0;
  if (!shown) return null;
  const noun = bodyNoun(read.summary);
  const source = file === null ? undefined : { file };
  return (
    <Section id="planet.initializer" title="Initializer">
      <div className="ins-init">
        {rows && (
          <Properties>
            {spawn.starting_planet && (
              <>
                <PropertyRow label="Start planet">Yes</PropertyRow>
                <Why>{START_PLANET_HINT}</Why>
              </>
            )}
            {spawn.home_planet && <PropertyRow label="Home planet">Yes</PropertyRow>}
            {from.map((source) => (
              <SetByRow key={`${source.label}-${source.name}`} source={source} />
            ))}
          </Properties>
        )}
        {spawn.script.length > 0 && (
          <Group
            id="planet.initializer.script"
            title={SCRIPT_TITLE}
            tail={counted(lineCount(spawn.script), "line")}
          >
            <div className="muted ins-hint">{bodyScriptHint(noun)}</div>
            <ScriptSnippet text={rawText(spawn.script)} source={source} />
          </Group>
        )}
        {spawn.other_keys.length > 0 && (
          <Group
            id="planet.initializer.other"
            title={OTHER_KEYS_TITLE}
            tail={`${spawn.other_keys.length}`}
          >
            <div className="muted ins-hint">{OTHER_KEYS_HINT}</div>
            <ScriptSnippet text={rawText(spawn.other_keys)} source={source} />
          </Group>
        )}
      </div>
    </Section>
  );
}

/** A deposit's or a planet feature's name, as its game data gives it. */
function usePoolNamer(): (key: string) => string {
  const deposits = usePlanetDataStore((s) => s.depositTypes);
  const modifiers = usePlanetDataStore((s) => s.modifiers);
  return (key) =>
    deposits.get(key)?.name ?? modifiers.get(key)?.name ?? keyWords(key.replace(/^(d_|pm_)/, ""));
}

/**
 * After the rows a scenario body's initializer states, what its own roll can give it, likeliest
 * first: nothing where it rolls none, and why where the class it rolls decides.
 */
export function PoolLines({
  pool,
  stated,
  kind,
}: {
  pool: SpawnPool | undefined;
  stated: number;
  kind: PoolKind;
}) {
  const named = usePoolNamer();
  if (pool === undefined || pool.state === "fixed") return null;
  if (pool.state === "unknown") {
    return (
      <>
        <div className="pl-sub-head">
          <Unknown>{DEPOSITS_UNKNOWN}</Unknown>
        </div>
        <div className="muted ins-hint">{kind.unknownWhy}</div>
      </>
    );
  }
  const picks = poolPicks(pool);
  if (picks.length === 0) return null;
  return (
    <>
      <div className="pl-sub-head">{poolTitle(stated, kind.tail(picks.length))}</div>
      <div className="ins-pool ins-st-rolled" title={ROLLED_TITLE}>
        {picks.map((pick, i) => (
          <span key={pick.key} title={pick.chance === null ? undefined : kind.chanceTitle}>
            {named(pick.key)}
            {pick.chance !== null && ` ${percent(pick.chance)}`}
            {i < picks.length - 1 && " ·"}
          </span>
        ))}
      </div>
    </>
  );
}
