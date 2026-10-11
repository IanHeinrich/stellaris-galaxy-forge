import type { BodySpawn } from "../../../generated/BodySpawn";
import type { SpawnStar } from "../../../generated/SpawnStar";
import { bodyClassName, bodyName } from "../../../lib/details/labels";
import {
  bodyNoun,
  bodyScriptHint,
  CLASS_DECIDED,
  comesFrom,
  copyLine,
  lineCount,
  MODEL_ROLLED,
  NAME_UNKNOWN,
  OTHER_KEYS_HINT,
  OTHER_KEYS_TITLE,
  percent,
  rawText,
  RING_ROLLED,
  rolledClassText,
  SCRIPT_TITLE,
  START_PLANET_HINT,
  starOdds,
  unknownClassWhy,
} from "../../../lib/details/spawnFacts";
import { templateName } from "../../../lib/names";
import { counted } from "../../../lib/text";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { ScriptSnippet } from "../../ScriptSnippet";
import { useNamed } from "../../useNamed";
import { Group, Properties, PropertyRow, Section } from "../parts";
import { ComesFrom, Rolled, Unknown, Why } from "../states";
import { PlanetSize } from "../system/sections/bodies";
import { useInitializerFile } from "../system/sections/scenario/useInitializerFile";
import { bodySize, rangeText } from "./bodyFields";
import type { BodyRead } from "./bodySources";
import type { PlanetSectionProps } from "./planetSection";

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
          {pool.kind === "planet_list" && (
            <Why>{pool.members.map((m) => bodyClassName(m.key, names)).join(" · ")}</Why>
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
  const { summary } = read;
  const size = bodySize(summary);
  const stated = spawn.name ?? (templateName(summary) === "" ? null : bodyName(summary, names));
  return (
    <Properties>
      <PropertyRow label="Name">{stated ?? <Unknown>{NAME_UNKNOWN}</Unknown>}</PropertyRow>
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
      {!star && (
        <PropertyRow label="Ring">
          {summary.ring === null ? <Rolled>{RING_ROLLED}</Rolled> : summary.ring ? "Yes" : "No"}
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
  const spawn = read.summary.spawn;
  if (spawn === undefined) return null;
  const copy = copyLine(spawn, read.summary.moon);
  return (
    <>
      {copy !== null && <div className="muted ins-hint">{copy}</div>}
      {spawn.from_script !== null && <ComesFrom>comes from {spawn.from_script}</ComesFrom>}
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
 * on it, the keys and script Galaxy Forge keeps as written, and where values come from.
 */
export function BodyInitializer({ read }: PlanetSectionProps) {
  const system = useGalaxyStore((s) => s.systems.get(read.details.id));
  const file = useInitializerFile(system?.initializer ?? "");
  const spawn = read.summary.spawn;
  if (spawn === undefined) return null;
  const from = comesFrom({ inline_scripts: [], variables: spawn.variables });
  const shown =
    spawn.starting_planet ||
    spawn.home_planet ||
    spawn.other_keys.length > 0 ||
    spawn.script.length > 0 ||
    from.length > 0;
  if (!shown) return null;
  const noun = bodyNoun(read.summary);
  const source = file === null ? undefined : { file };
  return (
    <Section id="planet.initializer" title="Initializer">
      <div className="ins-init">
        {(spawn.starting_planet || spawn.home_planet) && (
          <Properties>
            {spawn.starting_planet && (
              <>
                <PropertyRow label="Start planet">Yes</PropertyRow>
                <Why>{START_PLANET_HINT}</Why>
              </>
            )}
            {spawn.home_planet && <PropertyRow label="Home planet">Yes</PropertyRow>}
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
        {from.map((line) => (
          <ComesFrom key={line}>{line}</ComesFrom>
        ))}
      </div>
    </Section>
  );
}
