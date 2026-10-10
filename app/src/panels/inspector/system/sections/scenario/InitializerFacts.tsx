import type { SystemSpawn } from "../../../../../generated/SystemSpawn";
import type { UsageOdds } from "../../../../../generated/UsageOdds";
import {
  comesFrom,
  hasRandomOnly,
  instancesHint,
  instancesText,
  NEIGHBOURS_WHY,
  neighbourText,
  OTHER_KEYS_HINT,
  PRIMITIVE_HINT,
  RANDOM_ONLY_TITLE,
  randomOnlyHint,
  rawText,
  SYSTEM_SCRIPT_HINT,
} from "../../../../../lib/details/spawnFacts";
import { Properties, PropertyRow } from "../../../parts";
import { ComesFrom, RawText, SubHead, Why } from "../../../states";

/** `usage_odds` as written: a number, a value Galaxy Forge can't read, or a block of conditions. */
function UsageOddsRow({ odds }: { odds: UsageOdds }) {
  switch (odds.kind) {
    case "number":
      return <PropertyRow label="Usage odds">{odds.value}</PropertyRow>;
    case "unknown":
      return (
        <PropertyRow label="Usage odds" mono>
          {odds.written}
        </PropertyRow>
      );
    case "script":
      return (
        <>
          <PropertyRow label="Usage odds">
            {odds.base === null ? "set by a script" : `${odds.base}, changed by a script`}
          </PropertyRow>
          <span className="ins-why">
            <RawText text={odds.text} />
          </span>
        </>
      );
  }
}

/** What only a random galaxy reads: how it picks this layout and the systems it links to it. */
function RandomOnly({ spawn }: { spawn: SystemSpawn }) {
  if (!hasRandomOnly(spawn)) return null;
  return (
    <>
      <SubHead title={RANDOM_ONLY_TITLE} />
      <div className="muted ins-hint">{randomOnlyHint(spawn)}</div>
      <Properties>
        {spawn.usage !== null && (
          <PropertyRow label="Usage" mono>
            {spawn.usage}
          </PropertyRow>
        )}
        {spawn.usage_odds !== null && <UsageOddsRow odds={spawn.usage_odds} />}
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
    </>
  );
}

/**
 * What a scenario system's initializer says that a save has no field for: how many a galaxy
 * may hold, whether it is pre-FTL, its name list, what only a random galaxy reads, the keys and
 * script Galaxy Forge keeps as written, and where values come from.
 */
export function InitializerFacts({ spawn }: { spawn: SystemSpawn }) {
  const from = comesFrom(spawn);
  const rows = spawn.max_instances !== null || spawn.primitive_system || spawn.namelist !== null;
  return (
    <>
      {rows && (
        <Properties>
          {spawn.max_instances !== null && (
            <>
              <PropertyRow label="Instances">{instancesText(spawn.max_instances)}</PropertyRow>
              <Why>{instancesHint(spawn.max_instances)}</Why>
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
        </Properties>
      )}
      <RandomOnly spawn={spawn} />
      {spawn.other_keys.length > 0 && (
        <>
          <SubHead title="Other keys" count={spawn.other_keys.length} />
          <div className="muted ins-hint">{OTHER_KEYS_HINT}</div>
          <RawText text={rawText(spawn.other_keys)} />
        </>
      )}
      {spawn.script.length > 0 && (
        <>
          <SubHead title="Script" count={spawn.script.length} />
          <div className="muted ins-hint">{SYSTEM_SCRIPT_HINT}</div>
          <RawText text={rawText(spawn.script)} />
        </>
      )}
      {from.map((line) => (
        <ComesFrom key={line}>{line}</ComesFrom>
      ))}
    </>
  );
}
