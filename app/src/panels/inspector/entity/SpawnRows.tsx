import { useEffect, type ReactNode } from "react";
import type { BodySpawn } from "../../../generated/BodySpawn";
import { bodyName } from "../../../lib/details/labels";
import {
  CLASS_SUITED_VALUE,
  nameValue,
  ringValue,
  sizeValue,
} from "../../../lib/details/scenarioValues";
import { modelLabel } from "../../../lib/details/planetModel";
import {
  bodyFrom,
  bodyNoun,
  CAN_ROLL_TITLE,
  CHANGED_BY_EFFECT,
  classSuitedHint,
  copyFacts,
  depositsWithClass,
  emptyPool,
  featuresTail,
  featuresWithClass,
  mergedByName,
  neverLine,
  neverSpawns,
  picksOf,
  setsSize,
  sharedScriptHint,
  shownWithItsRow,
  STOPPED_LABEL,
  stoppedFacts,
  valueSources,
} from "../../../lib/details/spawnFacts";
import { depositKinds, depositKindsTail } from "../../../lib/details/depositBars";
import { templateName } from "../../../lib/names";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { OpenButton } from "../../OpenButton";
import { Group, Properties, PropertyRow, Section } from "../parts";
import { OtherLinesGroup, ScriptGroup } from "../ScriptGroup";
import { Hinted, HintedRow, SetByLines, SetByRows, StateValue, StoppedTag } from "../states";
import { PlanetSize } from "../system/sections/bodies";
import { useInitializerFile } from "../system/sections/scenario/useInitializerFile";
import { bodySize } from "./bodyFields";
import type { BodyRead } from "./bodySources";
import { DepositKindsList } from "./DepositPoolBars";
import type { PlanetSectionProps } from "./planetSection";
import { useGivenNames } from "./useBodyName";
import type { ClassPreview } from "./useClassPreview";
import { useFeatureNamer } from "./useFeatureNamer";
import { ClassRow } from "./ClassChooser";
import { FeaturePool } from "./Pools";

/** The Name row: the name the game gives the body, with how it numbers it in its card. */
function NameRow({ read, spawn, noun }: { read: BodyRead; spawn: BodySpawn; noun: string }) {
  const names = useGameDataStore((s) => s.names);
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const { summary } = read;
  const given = useGivenNames(read.details).get(summary.id);
  const stated = spawn.name ?? (templateName(summary) === "" ? null : bodyName(summary, names));
  const naming = spawn.naming;
  const parentId = naming?.state === "template" ? naming.parent : null;
  const parent = read.details.planets.find((p) => p.id === parentId);
  const parentNoun = parent === undefined ? "planet" : bodyNoun(parent, planetClasses);
  const { value, hint } = nameValue(given, naming, stated, noun, parentNoun);
  return (
    <HintedRow label="Name" hint={hint}>
      <StateValue value={value} />
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
  const value = sizeValue(spawn.changed_size, size);
  return (
    <HintedRow label="Size" hint={hint}>
      <StateValue value={value}>{suited ? undefined : <PlanetSize size={value.text} />}</StateValue>
    </HintedRow>
  );
}

/** A row whose value only the class the body rolls decides, with why in its card. */
function ClassSuitedRow({ label, noun }: { label: string; noun: string }) {
  return (
    <HintedRow label={label} hint={classSuitedHint(noun)}>
      <StateValue value={CLASS_SUITED_VALUE} />
    </HintedRow>
  );
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
          <DepositKindsList kinds={kinds} picked={false} />
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
          <FeaturePool picks={picks} picked={false} />
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
      <StateValue value={ringValue(ring, read.summary.ring)} />
    </PropertyRow>
  );
}

/** What the class picked decides, dimmed while what the body rolls as that class is read. */
export function ClassDependent({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <div className={busy ? "ins-class-dependent ins-busy" : "ins-class-dependent"} aria-busy={busy}>
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
  const picked = read.pickedClass !== undefined;
  return (
    <Properties>
      <NameRow read={read} spawn={spawn} noun={noun} />
      <ClassRow spawn={spawn} read={read} pick={preview} />
      <ClassDependent busy={preview.busy}>
        <SizeRow read={read} spawn={spawn} noun={noun} />
        {!star && placed && <RingRow read={read} spawn={spawn} noun={noun} />}
        {!star && spawn.entity !== null && <ModelRow entity={spawn.entity} />}
        {!star && placed && spawn.entity === null && <ClassSuitedRow label="Model" noun={noun} />}
        {placed && depositsWithClass(spawn, read.rows.deposits.count, picked) && (
          <ClassSuitedDeposits spawn={spawn} noun={noun} />
        )}
        {placed && featuresWithClass(spawn, read.rows.modifiers.length, picked) && (
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
 * Under a scenario body's head: its place among the bodies its block places, the inline script it
 * comes from, and the Open button for its `planet` or `moon` block.
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
      {(spawn.from_script !== null || spawn.at !== undefined) && (
        <div className="muted ins-init-sub">
          {spawn.from_script !== null && (
            <span className="ins-init-what">
              <Hinted label="Shared script" hint={sharedScriptHint(spawn.from_script)}>
                {bodyFrom(noun)}
              </Hinted>
            </span>
          )}
          {spawn.at !== undefined && (
            <span className="ins-init-links">
              <OpenButton target={spawn.at} />
            </span>
          )}
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
  const shown = variables.length > 0 || spawn.other_keys.length > 0 || spawn.script.length > 0;
  if (!shown) return null;
  return (
    <Section id="planet.initializer" title="Initializer">
      <div className="ins-init">
        {variables.length > 0 && (
          <Properties>
            <SetByRows uses={{ inline_scripts: [], variables }} moon={read.summary.moon} />
          </Properties>
        )}
        <ScriptGroup id="planet.initializer.script" statements={spawn.script} file={file} />
        <OtherLinesGroup id="planet.initializer.other" statements={spawn.other_keys} file={file} />
      </div>
    </Section>
  );
}
