import { useEffect, type ReactNode } from "react";
import type { BodySpawn } from "../../../generated/BodySpawn";
import type { SpawnPool } from "../../../generated/SpawnPool";
import { planetTint } from "../../../lib/details/icons";
import { bodyClassName, bodyName } from "../../../lib/details/labels";
import { NEUTRAL_BAR, oddsRows, readableTint } from "../../../lib/details/oddsBars";
import { modelLabel } from "../../../lib/details/planetModel";
import {
  bodyFrom,
  bodyNoun,
  CLASS_DECIDED,
  CLASS_SUITED,
  classFitHint,
  classListSource,
  classOdds,
  classSuitedHint,
  copyFacts,
  isAsteroidClass,
  LIST_ORBIT_HINT,
  NAME_RANDOM,
  NAME_RANDOM_WHY,
  neverLine,
  neverSpawns,
  poolPicks,
  poolTitle,
  type PoolKind,
  type PoolPick,
  RING_ROLLED,
  ringWords,
  rolledClassText,
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
  WITH_CLASS_LABEL,
  withClassHint,
  withClassParts,
  withClassWords,
} from "../../../lib/details/spawnFacts";
import {
  NAMED_AFTER_SYSTEM,
  namedAfterParent,
  parentUnnamedWhy,
  rolledNameWhy,
  SYSTEM_UNNAMED_WHY,
} from "../../../lib/details/spawnNames";
import { templateName } from "../../../lib/names";
import { keyWords } from "../../../lib/text";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { Properties, PropertyRow, Section } from "../parts";
import { OtherLinesGroup, ScriptGroup } from "../ScriptGroup";
import {
  Hinted,
  HintedRow,
  Rolled,
  RolledMark,
  SetByLines,
  SetByRow,
  StoppedTag,
  Unknown,
} from "../states";
import { PlanetIcon, PlanetSize } from "../system/sections/bodies";
import { StarOddsList } from "../system/sections/scenario/StarList";
import { useInitializerFile } from "../system/sections/scenario/useInitializerFile";
import { bodySize, rangeText } from "./bodyFields";
import type { BodyRead } from "./bodySources";
import { OddsList } from "./OddsBar";
import type { PlanetSectionProps } from "./planetSection";
import { useGivenNames } from "./useBodyName";

/** What the initializer's effect does to a value the block states. */
const CHANGED_BY_EFFECT = "The initializer changes it when a new game starts.";

/** Planet classes a draw can give, as an odds list: each class's icon and name, a bar and its share where known. */
function ClassList({ odds, moon }: { odds: readonly StarOdds[]; moon: boolean }) {
  const names = useGameDataStore((s) => s.names);
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  return (
    <div className="ins-why">
      <OddsList
        rows={oddsRows(odds, (key) => readableTint(planetTint(key))).map((row) => ({
          row,
          name: bodyClassName(row.key, names, moon),
          icon: (
            <PlanetIcon planetClass={row.key} sprite={planetClasses.get(row.key)?.icon_sprite} />
          ),
        }))}
      />
    </div>
  );
}

/** The Class row, with what decides it in its card, and the list of what it can be under it. */
function ClassRow({ spawn, read }: { spawn: BodySpawn; read: BodyRead }) {
  const names = useGameDataStore((s) => s.names);
  const { summary, details } = read;
  if (spawn.changed_class !== null) {
    return (
      <HintedRow label="Class" hint={CHANGED_BY_EFFECT}>
        {bodyClassName(spawn.changed_class, names)}
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
        ) : pool.kind === "random" && pool.at_orbit !== undefined && !exact ? (
          classFitHint(orbitRanged, starRolled)
        ) : null;
      return (
        <>
          <HintedRow label="Class" hint={hint}>
            <Rolled>
              {listed === null ? rolledClassText(pool) : starClassesWords(listed.members.length)}
            </Rolled>
          </HintedRow>
          {listed !== null && (
            <div className="ins-why">
              <StarOddsList star={listed} />
            </div>
          )}
          {pool.kind === "random" && pool.at_orbit !== undefined && pool.at_orbit.length > 0 && (
            <ClassList
              odds={classOdds(pool.at_orbit).map((o) => (exact ? o : { ...o, share: null }))}
              moon={summary.moon}
            />
          )}
          {pool.kind === "planet_list" && (
            <ClassList
              odds={pool.members.map((m) => ({ key: m.key, share: null }))}
              moon={summary.moon}
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
    const parentNoun = parent === undefined ? "planet" : bodyNoun(parent);
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

/**
 * A scenario body's facts in the save page's rows: its name, class and size, its ring and model
 * where the initializer says more than its class does, what only its class decides, and what the
 * initializer stops on it. Explanations show in each value's card.
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
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const { summary } = read;
  const noun = isAsteroidClass(summary.class, planetClasses) ? "asteroid" : bodyNoun(summary);
  const counts = { deposits: read.rows.deposits.count, modifiers: read.rows.modifiers.length };
  const withClass = neverSpawns(spawn) ? [] : withClassParts(spawn, { star, ...counts });
  const stopped = stoppedFacts(spawn, counts.modifiers, noun);
  const ringShown = !star && !neverSpawns(spawn) && !withClass.includes("ring");
  return (
    <Properties>
      <NameRow read={read} spawn={spawn} noun={noun} />
      <ClassRow spawn={spawn} read={read} />
      <SizeRow read={read} spawn={spawn} noun={noun} />
      {ringShown && (
        <PropertyRow label="Ring">
          {spawn.ring === undefined ? (
            summary.ring === null ? (
              <Rolled>{RING_ROLLED}</Rolled>
            ) : summary.ring ? (
              "Yes"
            ) : (
              "No"
            )
          ) : spawn.ring.state === "rolled" ? (
            <Rolled>{ringWords(spawn.ring)}</Rolled>
          ) : (
            ringWords(spawn.ring)
          )}
        </PropertyRow>
      )}
      {!star && spawn.entity !== null && <ModelRow entity={spawn.entity} />}
      {withClass.length > 0 && (
        <HintedRow label={WITH_CLASS_LABEL} hint={withClassHint(noun)}>
          <Rolled>{withClassWords(withClass)}</Rolled>
        </HintedRow>
      )}
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
  const noun = isAsteroidClass(summary.class, planetClasses) ? "asteroid" : bodyNoun(summary);
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

/** A planet feature's name, as its game data gives it. */
function useFeatureNamer(): (key: string) => string {
  const modifiers = usePlanetDataStore((s) => s.modifiers);
  return (key) => modifiers.get(key)?.name ?? keyWords(key.replace(/^pm_/, ""));
}

/** Planet features the roll can give, likeliest first: a bar for each whose chance is known. */
function FeatureOdds({ picks }: { picks: readonly PoolPick[] }) {
  const named = useFeatureNamer();
  const rows = oddsRows(
    picks.map((p) => ({ key: p.key, share: p.chance })),
    () => NEUTRAL_BAR,
  );
  return <OddsList rows={rows.map((row) => ({ row, name: named(row.key) }))} />;
}

/**
 * After the rows a scenario body's initializer states, what its own roll can give it, likeliest
 * first: nothing where it rolls none, and why where the class it rolls decides. `body` shows the
 * picks in place of the list of planet features.
 */
export function PoolLines({
  pool,
  stated,
  kind,
  noun,
  rows,
  body,
}: {
  pool: SpawnPool | undefined;
  stated: number;
  kind: PoolKind;
  /** What the page calls the body, for the cards. */
  noun: string;
  /** How many rows the picks show as; one each by default. */
  rows?: (picks: PoolPick[]) => number;
  body?: (picks: PoolPick[]) => ReactNode;
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
        <span className="ins-st-rolled">
          <RolledMark />
        </span>
        {poolTitle(stated, kind.tail(rows === undefined ? picks.length : rows(picks)))}
      </div>
      {body === undefined ? <FeatureOdds picks={picks} /> : body(picks)}
    </>
  );
}
