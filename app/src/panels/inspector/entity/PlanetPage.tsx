import { useEffect, useMemo } from "react";
import type { PlanetPage } from "../../../generated/PlanetPage";
import type { PlanetPageAnomaly } from "../../../generated/PlanetPageAnomaly";
import type { PlanetPageMoon } from "../../../generated/PlanetPageMoon";
import { bodyClassName, bodyName } from "../../../lib/details/labels";
import { findPlanet, isStarBody, starBodyEditable } from "../../../lib/details/starBody";
import {
  daysLeft,
  modifierRows,
  planetDataKeys,
  type ModifierRow,
} from "../../../lib/details/planetPage";
import type { PickerTarget } from "../../../lib/details/picker";
import { hasRingCheckbox, setPlanetRingOp } from "../../../lib/details/ring";
import { bodyEditHint, COLONY_SIZE, renamePlanetOp } from "../../../lib/details/planetEdits";
import { documentCapabilities } from "../../../lib/capabilities";
import { capabilityFor } from "../../../lib/entities";
import { templateName } from "../../../lib/names";
import { counted, thousands } from "../../../lib/text";
import { bodyOrbit } from "../../../lib/details/orbitEdits";
import { useDetailsStore } from "../../../store/detailsStore";
import { useCanEdit, useFileSessionStore } from "../../../store/fileSessionStore";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { openSystem } from "../../../store/commands";
import type { Entry } from "../../../store/inspectorStore";
import { useAnomalyPickerStore } from "../../../store/anomalyPickerStore";
import { planetPickerTarget } from "../../../store/planetEditAdapter";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { useSystemGeometry } from "../../../store/systemGeometry";
import { EditBlock, EditKey, EditRow, TextField, ToggleField } from "../../EditField";
import { useApplyOp } from "../../useApplyOp";
import { useNamed } from "../../useNamed";
import { Icon } from "../../parts";
import {
  DrillLink,
  DrillRow,
  Empty,
  LinkRow,
  Properties,
  PropertyRow,
  Section,
  Swatch,
} from "../parts";
import { StarRowIcon } from "../StarIcon";
import { READING_STARS } from "../system/StarClassLine";
import { PlanetIcon, PlanetSize } from "../system/sections/bodies";
import { PlanetRow } from "../system/sections/Planets";
import { EntityView } from "./EntityView";
import { OrbitBlock } from "./OrbitBlock";
import { AnomalyPicker } from "./AnomalyPicker";
import { ModifierPicker } from "./ModifierPicker";
import { PlanetDigSite } from "./PlanetDigSite";
import { PlanetDeposits } from "./PlanetDeposits";
import { DeletePlanetAction, RemoveColonyAction } from "./PlanetRemoval";
import { PlanetModelField } from "./PlanetModelField";
import { PlanetSystemField } from "./PlanetSystemField";
import { SizeField, StarBlock } from "./StarBlock";
import { useSingleStarClasses } from "./useBodyClasses";
import "./entity.css";
import { useOpenEntity, usePlanetPage } from "./useEntity";

/** Asks for the game data the page shows: its deposits, modifiers, designations and class names. */
function usePlanetData(page: PlanetPage): void {
  const generation = usePlanetDataStore((s) => s.generation);
  const keys = useMemo(() => planetDataKeys(page), [page]);
  useEffect(() => {
    usePlanetDataStore.getState().request(keys);
  }, [keys, generation]);
  useNamed([page.class, ...page.moons.map((m) => m.class)]);
}

function Head({ page }: { page: PlanetPage }) {
  const names = useGameDataStore((s) => s.names);
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const starClasses = useGameDataStore((s) => s.starClasses);
  const own = useSingleStarClasses().get(page.class);
  const star = isStarBody(page.class, planetClasses, starClasses);
  return (
    <div className={`ins-head${star ? " ins-star-head" : " pl-head"}`}>
      {star ? (
        own && <StarRowIcon view={own} />
      ) : (
        <PlanetIcon planetClass={page.class} sprite={planetClasses.get(page.class)?.icon_sprite} />
      )}
      <span className="name">{bodyName(page, names)}</span>
      <span className="muted mono">#{page.id}</span>
    </div>
  );
}

/** What the fields of a planet's block show; each is `null` where the page does not offer it. */
interface PlanetFields {
  /** The body's name as the page heads it. */
  name: string | null;
  /** The body's size, and the Size field's hover text on a colony. */
  size: { value: number | null; title?: string } | null;
  /** Its class and the model it has in place of the class's own. */
  model: { planetClass: string; current: string | null } | null;
  /** Whether it has a ring. */
  ring: boolean | null;
  /** The system it moves from. */
  system: number | null;
}

/** Whether a planet's block has any field to show. */
function hasFields(fields: PlanetFields): boolean {
  return Object.values(fields).some((field) => field !== null);
}

/** Planet `id`'s fields. */
function PlanetBlock({
  id,
  fields: { name, size, model, ring, system },
}: {
  id: number;
  fields: PlanetFields;
}) {
  const applyOp = useApplyOp();
  return (
    <EditBlock title="Planet">
      {name !== null && (
        <EditRow label="Name">
          <TextField
            kind="text"
            label="Name"
            title="Rename this planet. Its moons named after it follow."
            value={name}
            onCommit={(text) => {
              const op = renamePlanetOp(id, name, text);
              if (op !== null) applyOp(op);
            }}
          />
        </EditRow>
      )}
      {size !== null && (
        <EditRow label="Size">
          <SizeField id={id} size={size.value} title={size.title} />
        </EditRow>
      )}
      {model !== null && (
        <PlanetModelField id={id} planetClass={model.planetClass} current={model.current} />
      )}
      {ring !== null && (
        <ToggleField
          label="Ring"
          title="Draws a ring around this body"
          checked={ring}
          onChange={(on) => applyOp(setPlanetRingOp(id, on))}
        />
      )}
      {system !== null && <PlanetSystemField id={id} system={system} />}
    </EditBlock>
  );
}

function ModifierRowView({ row, onRemove }: { row: ModifierRow; onRemove: (() => void) | null }) {
  const view = row.view;
  const line = [
    ...(view?.effects.map((e) => e.text) ?? []),
    ...(row.days === null ? [] : [daysLeft(row.days)]),
  ].join(" · ");
  return (
    <div className="pl-mod">
      <span className="pl-mod-icon">
        <Icon keys={view?.icon == null ? [] : [view.icon]} glyph="◆" />
        {view?.icon_frame != null && <Icon className="pl-mod-frame" keys={[view.icon_frame]} />}
      </span>
      <span>
        <span className={view === undefined ? "l1 mono" : "l1"}>{view?.name ?? row.key}</span>
        {line !== "" && <span className="l2">{line}</span>}
      </span>
      {onRemove !== null && (
        <button
          type="button"
          className="pl-dep-remove pl-mod-remove"
          title={row.feature ? "Remove this planet feature" : "Remove this modifier"}
          aria-label={`Remove ${view?.name ?? row.key}`}
          onClick={onRemove}
        >
          ✕
        </button>
      )}
    </div>
  );
}

/**
 * The planet's modifiers; where `editable`, each with its remove button and the picker below,
 * both through `target`'s adapter.
 */
function PlanetModifiers({
  page,
  editable,
  target,
}: {
  page: PlanetPage;
  editable: boolean;
  target: PickerTarget;
}) {
  const views = usePlanetDataStore((s) => s.modifiers);
  const rows = modifierRows(page, views);
  if (rows.length === 0 && !editable) return null;
  return (
    <Section id="planet.modifiers" title="Modifiers" count={rows.length}>
      {rows.map((row) => (
        <ModifierRowView
          key={row.key}
          row={row}
          onRemove={editable ? () => void target.edits.removeModifier(row) : null}
        />
      ))}
      {editable && <ModifierPicker target={target} />}
    </Section>
  );
}

/** A row naming a country, whose name opens its page. */
function CountryRow({ label, id }: { label: string; id: number }) {
  const opener = useOpenEntity();
  const country = useGalaxyStore((s) => s.countries.get(id));
  const name = country === undefined ? `country #${id}` : templateName(country);
  return (
    <PropertyRow label={label}>
      <span className="pl-country">
        <Swatch owner={id} />
        <DrillLink
          requires={capabilityFor("country")}
          title="Open the empire's page"
          onOpen={() => opener.open({ kind: "country", id }, name)}
        >
          {name}
        </DrillLink>
      </span>
    </PropertyRow>
  );
}

/** The colony's facts, and its removal when `removable` names the body. */
function Colony({ page, removable }: { page: PlanetPage; removable: string | null }) {
  const colonyTypes = usePlanetDataStore((s) => s.colonyTypes);
  const opener = useOpenEntity();
  const colony = page.colony;
  if (colony === null || page.owner === null) return null;
  const designation = colony.final_designation ?? colony.designation;
  const type = designation === null ? undefined : colonyTypes.get(designation);
  const split = colony.species.map(
    (s) =>
      `${s.name.key === "" ? `species #${s.id}` : templateName({ name: s.name, name_key: s.name.key })} ${thousands(s.pops)}`,
  );
  return (
    <Section id="planet.colony" title="Colony">
      <Properties>
        <CountryRow label="Owner" id={page.owner} />
        {designation !== null && (
          <PropertyRow label="Designation">
            <span className="pl-designation">
              {type?.icon != null && <Icon className="gi" keys={[type.icon]} />}
              {type?.name ?? designation}
            </span>
          </PropertyRow>
        )}
        {colony.colonised !== null && (
          <PropertyRow label="Colonised">{colony.colonised}</PropertyRow>
        )}
        <PropertyRow label="Pops">{[thousands(colony.pops), ...split].join(" · ")}</PropertyRow>
        <LinkRow
          label="Colony"
          requires={capabilityFor("colony")}
          title="Open the colony's page"
          onOpen={() => opener.open({ kind: "colony", id: colony.id }, `Colony #${colony.id}`)}
        >
          #{colony.id}
        </LinkRow>
      </Properties>
      {removable !== null && <RemoveColonyAction page={page} name={removable} />}
    </Section>
  );
}

/** Planet `id` as the read systems list it, or null while none does. */
function useFoundPlanet(id: number) {
  const details = useDetailsStore((s) => s.details);
  return useMemo(() => findPlanet(details, id), [details, id]);
}

/** The body this one orbits, named as the system list names it. */
function useBodyName(id: number): string {
  const names = useGameDataStore((s) => s.names);
  const found = useFoundPlanet(id);
  return found === null ? `#${id}` : bodyName(found.planet, names);
}

function Orbits({ parent, radius }: { parent: number; radius: number | null }) {
  const opener = useOpenEntity();
  const name = useBodyName(parent);
  return (
    <PropertyRow label="Orbits">
      <DrillLink
        requires={capabilityFor("planet")}
        title="Open the page of the body it orbits"
        onOpen={() => opener.open({ kind: "planet", id: parent }, name)}
      >
        {name}
      </DrillLink>
      {radius !== null && <span className="muted"> radius {radius}</span>}
    </PropertyRow>
  );
}

/** Who has found `anomaly`: "found by …", or "not found yet". */
function useFinders(anomaly: PlanetPageAnomaly): string {
  const countries = useGalaxyStore((s) => s.countries);
  const finders = anomaly.found_by.map((id) => {
    const country = countries.get(id);
    return country === undefined ? `country #${id}` : templateName(country);
  });
  return finders.length === 0 ? "not found yet" : `found by ${finders.join(", ")}`;
}

/** The anomaly waiting on the planet, by the name the game gives its category, and who found it. */
function AnomalyRow({ anomaly }: { anomaly: PlanetPageAnomaly }) {
  const named = useNamed([anomaly.category]);
  const found = useFinders(anomaly);
  return (
    <PropertyRow label="Anomaly">
      {named(anomaly.category)}
      <span className="muted">
        {" · "}
        {found}
      </span>
    </PropertyRow>
  );
}

/**
 * The anomaly as the Anomaly section lists it: its name, who found it, the game's description of
 * it once the anomaly choices are read, and its remove button.
 */
function AnomalyRowView({ anomaly, target }: { anomaly: PlanetPageAnomaly; target: PickerTarget }) {
  const named = useNamed([anomaly.category]);
  const found = useFinders(anomaly);
  const name = named(anomaly.category);
  const ready = useGameDataStore((s) => s.status === "ready");
  const description = useAnomalyPickerStore(
    (s) => s.choices?.list.find((c) => c.key === anomaly.category)?.description ?? null,
  );
  useEffect(() => {
    if (ready) useAnomalyPickerStore.getState().load(target);
  }, [ready, target]);
  return (
    <div className="pl-mod">
      <span className="pl-mod-icon">
        <Icon keys={[]} glyph="?" />
      </span>
      <span>
        <span className="l1">{name}</span>
        <span className="l2">{found}</span>
        {ready && description !== null && <span className="pl-anomaly-desc">{description}</span>}
      </span>
      <button
        type="button"
        className="pl-dep-remove pl-mod-remove"
        title="Remove this anomaly"
        aria-label={`Remove ${name}`}
        onClick={() => void target.edits.removeAnomaly()}
      >
        ✕
      </button>
    </div>
  );
}

/** The body's anomaly as `target` holds it, with its remove button, or the picker that adds one. */
function PlanetAnomaly({ target }: { target: PickerTarget }) {
  return (
    <Section id="planet.anomaly" title="Anomaly">
      {target.anomaly === null ? (
        <AnomalyPicker target={target} />
      ) : (
        <AnomalyRowView anomaly={target.anomaly} target={target} />
      )}
    </Section>
  );
}

/**
 * What the page only shows; `radius` is the body's orbit where no Orbit block edits it, and the
 * anomaly shows here where no Anomaly section edits it.
 */
function About({
  page,
  radius,
  anomalyEditable,
}: {
  page: PlanetPage;
  radius: number | null;
  anomalyEditable: boolean;
}) {
  const systemName = useGalaxyStore((s) => s.systemName);
  const system = page.system;
  const occupied = page.controller !== null && page.controller !== page.owner;
  return (
    <>
      <div className="edit-block-title ins-about">About</div>
      <Properties>
        {system !== null && (
          <LinkRow label="System" title="Open the system's page" onOpen={() => openSystem(system)}>
            {systemName(system)}
          </LinkRow>
        )}
        {page.parent !== null && <Orbits parent={page.parent} radius={radius} />}
        {page.surveyed_by !== null && <CountryRow label="Surveyed by" id={page.surveyed_by} />}
        {page.anomaly !== null && !anomalyEditable && <AnomalyRow anomaly={page.anomaly} />}
        {occupied && page.controller !== null && (
          <CountryRow label="Controller" id={page.controller} />
        )}
        {page.flags > 0 && <PropertyRow label="Flags">{counted(page.flags, "flag")}</PropertyRow>}
      </Properties>
    </>
  );
}

/** A moon no read system lists: its class and size, opening its own page. */
function MoonFallbackRow({ moon }: { moon: PlanetPageMoon }) {
  const names = useGameDataStore((s) => s.names);
  const classes = useGameDataStore((s) => s.planetClasses);
  const opener = useOpenEntity();
  const named = templateName(moon);
  const name = bodyName(moon, names);
  return (
    <DrillRow
      requires={capabilityFor("planet")}
      onOpen={() => opener.open({ kind: "planet", id: moon.id }, name)}
    >
      <PlanetIcon planetClass={moon.class} sprite={classes.get(moon.class)?.icon_sprite} />
      <span>
        <span className="l1">{name}</span>
        <span className="l2">
          {named !== "" && bodyClassName(moon.class, names)}
          {moon.size !== null && <PlanetSize size={moon.size} />}
        </span>
      </span>
    </DrillRow>
  );
}

function Moons({ page }: { page: PlanetPage }) {
  const read = useDetailsStore((s) =>
    page.system === null ? undefined : s.details.get(page.system),
  );
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const starClasses = useGameDataStore((s) => s.starClasses);
  const bodies = useCanEdit("bodies");
  if (page.moons.length === 0) return null;
  return (
    <Section id="planet.moons" title="Moons" count={page.moons.length}>
      {page.moons.map((moon) => {
        const summary = read?.planets.find((p) => p.id === moon.id);
        if (read === undefined || summary === undefined) {
          return <MoonFallbackRow key={moon.id} moon={moon} />;
        }
        return (
          <PlanetRow
            key={moon.id}
            planet={{ ...summary, moon: false }}
            details={read}
            editHint={bodyEditHint(summary.class, bodies, planetClasses, starClasses)}
          />
        );
      })}
    </Section>
  );
}

/**
 * A save body's Overview: a star's own fields first, then what the body is, holds and carries,
 * who lives there, where it is and the moons around it.
 */
function PlanetOverview({ page }: { page: PlanetPage }) {
  usePlanetData(page);
  const names = useGameDataStore((s) => s.names);
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const starClasses = useGameDataStore((s) => s.starClasses);
  const bodies = useCanEdit("bodies");
  const geometry = useCanEdit("geometry");
  const found = useFoundPlanet(page.id);
  const system = useGalaxyStore((s) => (found === null ? undefined : s.systems.get(found.system)));
  const star = starBodyEditable(page.class, bodies, planetClasses, starClasses);
  const starBlock = star && found !== null && system !== undefined;
  const starBody = isStarBody(page.class, planetClasses, starClasses);
  const ring =
    geometry && found !== null && hasRingCheckbox(page.class, planetClasses, starClasses)
      ? found.planet.ring === true
      : null;
  const movable = useFileSessionStore((s) => documentCapabilities(s).details);
  const moveFrom = movable ? page.system : null;
  const planetBody = bodies && !starBody;
  const resizable = planetBody;
  // A 4.x save: the deposit, modifier, dig site and anomaly ops refuse an older one.
  const depositsEditable = useCanEdit("deposits");
  const modifiersEditable = planetBody && depositsEditable;
  // The game places some anomalies on stars, so a star's page takes one too.
  const anomalyEditable = depositsEditable;
  const moon = found?.planet.moon ?? false;
  // A 4.x save's planet or moon: the core says why one of them cannot go.
  const removable = depositsEditable && !starBody;
  const target = useMemo(() => planetPickerTarget(page, moon), [page, moon]);
  const fields: PlanetFields = {
    name: planetBody ? bodyName(page, names) : null,
    size: resizable
      ? { value: page.size, title: page.colony === null ? undefined : COLONY_SIZE }
      : null,
    model: modifiersEditable ? { planetClass: page.class, current: page.entity_name } : null,
    ring,
    system: moveFrom,
  };
  const requestDetails = useDetailsStore((s) => s.request);
  const detailsVersion = useDetailsStore((s) => s.version);
  const waiting = useDetailsStore((s) => page.system !== null && !s.failed.has(page.system));
  const { layout, editing } = useSystemGeometry(page.system);
  const orbit = bodyOrbit(layout, page.id);
  const orbitable = orbit !== null && editing.bodies.get(page.id)?.move === true;
  const radius = orbitable || orbit === null ? null : Math.round(orbit.radius);
  // The star's and the orbit's fields need the system's details, which a page reached from search
  // may not have read.
  useEffect(() => {
    if (page.system !== null) requestDetails([page.system]);
  }, [page.system, requestDetails, detailsVersion]);
  return (
    <>
      <Head page={page} />
      {hasFields(fields) && <PlanetBlock id={page.id} fields={fields} />}
      {starBlock && <StarBlock planet={found.planet} system={system} />}
      {!starBlock && star && waiting && <Empty>{READING_STARS}</Empty>}
      {page.system !== null && <OrbitBlock system={page.system} body={page.id} />}
      {!starBlock && !(star && waiting) && (
        <Properties>
          <PropertyRow label="Class">{bodyClassName(page.class, names)}</PropertyRow>
          {page.size !== null && !resizable && <PropertyRow label="Size">{page.size}</PropertyRow>}
        </Properties>
      )}
      <PlanetDeposits page={page} editable={depositsEditable} target={target} />
      <PlanetModifiers page={page} editable={modifiersEditable} target={target} />
      {anomalyEditable && <PlanetAnomaly target={target} />}
      <PlanetDigSite site={page.dig_site} editable={modifiersEditable} target={target} />
      <Colony page={page} removable={removable ? bodyName(page, names) : null} />
      <About page={page} radius={radius} anomalyEditable={anomalyEditable} />
      <Moons page={page} />
      {removable && <DeletePlanetAction page={page} name={bodyName(page, names)} moon={moon} />}
      {(starBlock || hasFields(fields) || depositsEditable || modifiersEditable || orbitable) && (
        <EditKey />
      )}
    </>
  );
}

/** A save body's page, read on first view; a body the save cannot answer for is the generic view. */
export function PlanetPageView({ entry, id }: { entry: Entry; id: number }) {
  const { value: page, error } = usePlanetPage(id);
  if (error !== undefined) return <EntityView entry={entry} />;
  if (page === undefined) {
    return (
      <>
        <div className="ins-head">
          <span className="name">{entry.label}</span>
          <span className="muted mono">#{id}</span>
        </div>
        <Empty>Reading the planet…</Empty>
      </>
    );
  }
  return <PlanetOverview page={page} />;
}
