import type { SystemSpawn } from "../../../../../generated/SystemSpawn";
import type { UsageOdds } from "../../../../../generated/UsageOdds";
import {
  hasRandomOnly,
  NEIGHBOURS_WHY,
  neighbourText,
  perGalaxyHint,
  perGalaxyText,
  PRIMITIVE_HINT,
  RANDOM_SETTINGS_HINT,
  RANDOM_SETTINGS_TAIL,
  RANDOM_SETTINGS_TITLE,
  SCALED_CHANCE_HINT,
  SPAWN_CHANCE_HINT,
  usageOddsHint,
  usageOddsText,
  usageWeight,
  usageWords,
  valueSources,
} from "../../../../../lib/details/spawnFacts";
import { ScriptSnippet, type SnippetSource } from "../../../../ScriptSnippet";
import { Group, Properties, PropertyRow } from "../../../parts";
import { HintedRow, SetByRow } from "../../../states";
import { OtherLinesGroup, ScriptGroup } from "../../../ScriptGroup";

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
      return (
        <HintedRow label="How often" hint={usageOddsHint(odds.base)}>
          {usageOddsText(odds.base)}
        </HintedRow>
      );
  }
}

/** What only a random galaxy reads: how often it adds this system and the systems it links to it. */
function RandomSettings({ spawn, source }: { spawn: SystemSpawn; source?: SnippetSource }) {
  const odds = spawn.usage_odds;
  const chances =
    spawn.spawn_chance !== null || spawn.scaled_spawn_chance !== null || spawn.neighbors.length > 0;
  return (
    <>
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
            <HintedRow label="Spawn chance" hint={SPAWN_CHANCE_HINT}>
              {spawn.spawn_chance}
            </HintedRow>
          )}
          {spawn.scaled_spawn_chance !== null && (
            <HintedRow label="Scaled chance" hint={SCALED_CHANCE_HINT}>
              {spawn.scaled_spawn_chance}
            </HintedRow>
          )}
          {spawn.neighbors.length > 0 && (
            <>
              <HintedRow label="Neighbours" hint={NEIGHBOURS_WHY}>
                {spawn.neighbors.length}
              </HintedRow>
              <span className="ins-why mono">
                {spawn.neighbors.map((n, i) => (
                  <div key={`${n.initializer}-${i}`}>{neighbourText(n)}</div>
                ))}
              </span>
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
        <HintedRow label="Per galaxy" hint={perGalaxyHint(spawn.max_instances)}>
          {perGalaxyText(spawn.max_instances)}
        </HintedRow>
      )}
      {spawn.primitive_system && (
        <HintedRow label="Pre-FTL" hint={PRIMITIVE_HINT}>
          Yes
        </HintedRow>
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
      <ScriptGroup id="system.initializer.script" statements={spawn.script} file={file} />
      {hasRandomOnly(spawn) && (
        <Group
          id="system.initializer.random"
          title={RANDOM_SETTINGS_TITLE}
          hint={RANDOM_SETTINGS_HINT}
          tail={RANDOM_SETTINGS_TAIL}
          folded
        >
          <RandomSettings spawn={spawn} source={source} />
        </Group>
      )}
      <OtherLinesGroup id="system.initializer.other" statements={spawn.other_keys} file={file} />
    </>
  );
}
