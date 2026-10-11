import type { SystemSpawn } from "../../../../../generated/SystemSpawn";
import type { UsageOdds } from "../../../../../generated/UsageOdds";
import {
  hasRandomOnly,
  lineCount,
  NEIGHBOURS_WHY,
  neighbourText,
  OTHER_KEYS_HINT,
  OTHER_KEYS_TITLE,
  perGalaxyHint,
  perGalaxyText,
  PRIMITIVE_HINT,
  RANDOM_SETTINGS_HINT,
  RANDOM_SETTINGS_TAIL,
  RANDOM_SETTINGS_TITLE,
  rawText,
  SCRIPT_TITLE,
  SYSTEM_SCRIPT_HINT,
  usageOddsText,
  usageWeight,
  usageWords,
  valueSources,
} from "../../../../../lib/details/spawnFacts";
import { counted } from "../../../../../lib/text";
import { ScriptSnippet, type SnippetSource } from "../../../../ScriptSnippet";
import { Group, Properties, PropertyRow } from "../../../parts";
import { SetByRow, Why } from "../../../states";

/** `usage_odds` as written: a number, a value Galaxy Forge can't read, or where conditions change it. */
function HowOftenRow({ odds }: { odds: UsageOdds }) {
  switch (odds.kind) {
    case "number":
      return <PropertyRow label="How often">{usageWeight(odds.value)}</PropertyRow>;
    case "unknown":
      return (
        <PropertyRow label="How often" mono>
          {odds.written}
        </PropertyRow>
      );
    case "script":
      return <PropertyRow label="How often">{usageOddsText(odds.base)}</PropertyRow>;
  }
}

/** What only a random galaxy reads: how often it adds this system and the systems it links to it. */
function RandomSettings({ spawn, source }: { spawn: SystemSpawn; source?: SnippetSource }) {
  const odds = spawn.usage_odds;
  const chances =
    spawn.spawn_chance !== null || spawn.scaled_spawn_chance !== null || spawn.neighbors.length > 0;
  return (
    <>
      <div className="muted ins-hint">{RANDOM_SETTINGS_HINT}</div>
      {(spawn.usage !== null || odds !== null) && (
        <Properties>
          {spawn.usage !== null && (
            <PropertyRow label="Used as">
              <span title={spawn.usage}>{usageWords(spawn.usage)}</span>
            </PropertyRow>
          )}
          {odds !== null && <HowOftenRow odds={odds} />}
        </Properties>
      )}
      {odds?.kind === "script" && <ScriptSnippet text={odds.text} source={source} />}
      {chances && (
        <Properties>
          {spawn.spawn_chance !== null && (
            <PropertyRow label="Spawn chance">{spawn.spawn_chance}</PropertyRow>
          )}
          {spawn.scaled_spawn_chance !== null && (
            <PropertyRow label="Scaled chance">{spawn.scaled_spawn_chance}</PropertyRow>
          )}
          {spawn.neighbors.length > 0 && (
            <>
              <PropertyRow label="Neighbours">{spawn.neighbors.length}</PropertyRow>
              <span className="ins-why mono">
                {spawn.neighbors.map((n, i) => (
                  <div key={`${n.initializer}-${i}`}>{neighbourText(n)}</div>
                ))}
              </span>
              <Why>{NEIGHBOURS_WHY}</Why>
            </>
          )}
        </Properties>
      )}
    </>
  );
}

/**
 * The Initializer section's rows a scenario system's initializer states and a save has no field
 * for: how many a galaxy may hold, whether it is pre-FTL, its name list, and the values an inline
 * script or an `@variable` sets. They go inside the section's one `Properties` grid.
 */
export function StatedRows({ spawn }: { spawn: SystemSpawn }) {
  return (
    <>
      {spawn.max_instances !== null && (
        <>
          <PropertyRow label="Per galaxy">{perGalaxyText(spawn.max_instances)}</PropertyRow>
          <Why>{perGalaxyHint(spawn.max_instances)}</Why>
        </>
      )}
      {spawn.primitive_system && (
        <>
          <PropertyRow label="Pre-FTL">Yes</PropertyRow>
          <Why>{PRIMITIVE_HINT}</Why>
        </>
      )}
      {spawn.namelist !== null && (
        <PropertyRow label="Name list" mono>
          {spawn.namelist}
        </PropertyRow>
      )}
      {valueSources(spawn).map((source) => (
        <SetByRow key={`${source.label}-${source.name}`} source={source} />
      ))}
    </>
  );
}

/**
 * The groups under the Initializer section's rows: the script the initializer runs, what only a
 * random galaxy reads, and the keys Galaxy Forge keeps as written.
 * `file` is the initializer's file, which each snippet names.
 */
export function StatedGroups({ spawn, file }: { spawn: SystemSpawn; file: string | null }) {
  const source = file === null ? undefined : { file };
  return (
    <>
      {spawn.script.length > 0 && (
        <Group
          id="system.initializer.script"
          title={SCRIPT_TITLE}
          tail={counted(lineCount(spawn.script), "line")}
        >
          <div className="muted ins-hint">{SYSTEM_SCRIPT_HINT}</div>
          <ScriptSnippet text={rawText(spawn.script)} source={source} />
        </Group>
      )}
      {hasRandomOnly(spawn) && (
        <Group
          id="system.initializer.random"
          title={RANDOM_SETTINGS_TITLE}
          tail={RANDOM_SETTINGS_TAIL}
        >
          <RandomSettings spawn={spawn} source={source} />
        </Group>
      )}
      {spawn.other_keys.length > 0 && (
        <Group
          id="system.initializer.other"
          title={OTHER_KEYS_TITLE}
          tail={`${spawn.other_keys.length}`}
        >
          <div className="muted ins-hint">{OTHER_KEYS_HINT}</div>
          <ScriptSnippet text={rawText(spawn.other_keys)} source={source} />
        </Group>
      )}
    </>
  );
}
