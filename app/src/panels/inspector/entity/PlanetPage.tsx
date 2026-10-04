import { useEffect, useMemo, type ComponentType } from "react";
import type { PlanetPage } from "../../../generated/PlanetPage";
import { bodyClassName, bodyName } from "../../../lib/details/labels";
import { findPlanet, isStarBody } from "../../../lib/details/starBody";
import { planetDataKeys } from "../../../lib/details/planetPage";
import type { PlanetEditAdapter } from "../../../lib/details/picker";
import { planetPageOffers } from "../../../lib/details/planetOffers";
import { hasRingCheckbox } from "../../../lib/details/ring";
import { COLONY_SIZE } from "../../../lib/details/planetEdits";
import { documentCapabilities } from "../../../lib/capabilities";
import { capabilityFor } from "../../../lib/entities";
import { counted } from "../../../lib/text";
import { bodyOrbit } from "../../../lib/details/orbitIntent";
import { useDetailsStore } from "../../../store/detailsStore";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { openSystem } from "../../../store/commands";
import type { Entry } from "../../../store/inspectorStore";
import { planetPickerTarget } from "../../../store/planetEditAdapter";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { useSystemGeometry } from "../../../store/systemGeometry";
import { EditBlock, EditKey, EditRow, TextField, ToggleField } from "../../EditField";
import { useNamed } from "../../useNamed";
import { DrillLink, Empty, LinkRow, Properties, PropertyRow } from "../parts";
import { StarRowIcon } from "../StarIcon";
import { READING_STARS } from "../system/StarClassLine";
import { PlanetIcon } from "../system/sections/bodies";
import { EntityView } from "./EntityView";
import { OrbitBlock } from "./OrbitBlock";
import { openBody } from "./openBody";
import { AnomalyRow, PlanetAnomaly } from "./PlanetAnomaly";
import { CountryRow, PlanetColony } from "./PlanetColony";
import { PlanetDigSite } from "./PlanetDigSite";
import { PlanetDeposits } from "./PlanetDeposits";
import { PlanetClassField } from "./PlanetClassField";
import { PlanetModifiers } from "./PlanetModifiers";
import { PlanetMoons } from "./PlanetMoons";
import { DeletePlanetAction } from "./PlanetRemoval";
import { PlanetModelField } from "./PlanetModelField";
import type { PlanetSectionProps } from "./planetSection";
import { PlanetSystemField } from "./PlanetSystemField";
import { SizeField, StarBlock } from "./StarBlock";
import { useBodyName } from "./useBodyName";
import { useSingleStarClasses } from "./useStarClasses";
import "./entity.css";
import { usePlanetPage } from "./useEntity";

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
        <PlanetIcon
          planetClass={page.class}
          sprite={planetClasses.get(page.class)?.icon_sprite}
          seed={page.id}
        />
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
  /** Its class, and whether a colony or a moon narrows the classes it may take. */
  planetClass: { current: string; colonised: boolean; moon: boolean } | null;
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

/** Planet `id`'s fields, each sent to `edits`. */
function PlanetBlock({
  id,
  edits,
  fields: { name, size, planetClass, model, ring, system },
}: {
  id: number;
  edits: PlanetEditAdapter;
  fields: PlanetFields;
}) {
  return (
    <EditBlock title="Planet">
      {name !== null && (
        <EditRow label="Name">
          <TextField
            kind="text"
            label="Name"
            title="Rename this planet. Its moons named after it follow."
            value={name}
            onCommit={(text) => void edits.rename(text, name)}
          />
        </EditRow>
      )}
      {size !== null && (
        <EditRow label="Size">
          <SizeField edits={edits} size={size.value} title={size.title} />
        </EditRow>
      )}
      {planetClass !== null && (
        <PlanetClassField
          id={id}
          edits={edits}
          planetClass={planetClass.current}
          colonised={planetClass.colonised}
          moon={planetClass.moon}
        />
      )}
      {model !== null && (
        <PlanetModelField edits={edits} planetClass={model.planetClass} current={model.current} />
      )}
      {ring !== null && (
        <ToggleField
          label="Ring"
          title="Draws a ring around this body"
          checked={ring}
          onChange={(on) => void edits.setRing(on)}
        />
      )}
      {system !== null && <PlanetSystemField id={id} system={system} />}
    </EditBlock>
  );
}

/** Planet `id` as the read systems list it, or null while none does. */
function useFoundPlanet(id: number) {
  const details = useDetailsStore((s) => s.details);
  return useMemo(() => findPlanet(details, id), [details, id]);
}

function Orbits({
  system,
  parent,
  radius,
}: {
  system: number | null;
  parent: number;
  radius: number | null;
}) {
  const name = useBodyName(parent);
  return (
    <PropertyRow label="Orbits">
      <DrillLink
        requires={capabilityFor("planet")}
        title="Open the page of the body it orbits"
        onOpen={() => openBody(system, parent, name)}
      >
        {name}
      </DrillLink>
      {radius !== null && <span className="muted"> radius {radius}</span>}
    </PropertyRow>
  );
}

/**
 * What the page only shows; `radius` is the body's orbit where no Orbit block edits it, and the
 * anomaly shows here where no Anomaly section edits it.
 */
function About({ page, offers, radius }: PlanetSectionProps) {
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
        {page.parent !== null && <Orbits system={system} parent={page.parent} radius={radius} />}
        {page.surveyed_by !== null && <CountryRow label="Surveyed by" id={page.surveyed_by} />}
        {page.anomaly !== null && !offers.anomaly && <AnomalyRow anomaly={page.anomaly} />}
        {occupied && page.controller !== null && (
          <CountryRow label="Controller" id={page.controller} />
        )}
        {page.flags > 0 && <PropertyRow label="Flags">{counted(page.flags, "flag")}</PropertyRow>}
      </Properties>
    </>
  );
}

/** The page's Delete, where the page offers removal. */
function DeleteSection({ page, offers, target }: PlanetSectionProps) {
  const names = useGameDataStore((s) => s.names);
  if (!offers.pageRemoval) return null;
  return (
    <DeletePlanetAction
      page={page}
      name={bodyName(page, names)}
      moon={target.moon}
      edits={target.edits}
    />
  );
}

/** What the page lists below its fields, in order; each leaves itself out where it has nothing to show. */
const SECTIONS: readonly { id: string; Component: ComponentType<PlanetSectionProps> }[] = [
  { id: "deposits", Component: PlanetDeposits },
  { id: "modifiers", Component: PlanetModifiers },
  { id: "anomaly", Component: PlanetAnomaly },
  { id: "digSite", Component: PlanetDigSite },
  { id: "colony", Component: PlanetColony },
  { id: "about", Component: About },
  { id: "moons", Component: PlanetMoons },
  { id: "delete", Component: DeleteSection },
];

/**
 * A save body's Overview: a star's own fields first, then what the body is, holds and carries,
 * who lives there, where it is and the moons around it.
 */
function PlanetOverview({ page }: { page: PlanetPage }) {
  usePlanetData(page);
  const names = useGameDataStore((s) => s.names);
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const starClasses = useGameDataStore((s) => s.starClasses);
  const capabilities = useFileSessionStore((s) => documentCapabilities(s));
  const found = useFoundPlanet(page.id);
  const system = useGalaxyStore((s) => (found === null ? undefined : s.systems.get(found.system)));
  const offers = planetPageOffers(capabilities, {
    star: isStarBody(page.class, planetClasses, starClasses),
    ringable: found !== null && hasRingCheckbox(page.class, planetClasses, starClasses),
    moonHost: false,
  });
  const starBlock = offers.starFields && found !== null && system !== undefined;
  const moon = found?.planet.moon ?? false;
  const target = useMemo(() => planetPickerTarget(page, moon), [page, moon]);
  const name = bodyName(page, names);
  const fields: PlanetFields = {
    name: offers.planetFields ? name : null,
    size: offers.planetFields
      ? { value: page.size, title: page.colony === null ? undefined : COLONY_SIZE }
      : null,
    planetClass: offers.planetClass
      ? { current: page.class, colonised: page.colony !== null, moon }
      : null,
    model: offers.planetClass ? { planetClass: page.class, current: page.entity_name } : null,
    ring: offers.ring ? found?.planet.ring === true : null,
    system: offers.move ? page.system : null,
  };
  const editsAny = offers.deposits || offers.modifiers || offers.digSite || offers.anomaly;
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
      {hasFields(fields) && <PlanetBlock id={page.id} edits={target.edits} fields={fields} />}
      {starBlock && <StarBlock planet={found.planet} system={system} edits={target.edits} />}
      {!starBlock && offers.starFields && waiting && <Empty>{READING_STARS}</Empty>}
      {page.system !== null && <OrbitBlock system={page.system} body={page.id} />}
      {!starBlock && !(offers.starFields && waiting) && (
        <Properties>
          {!offers.planetClass && (
            <PropertyRow label="Class">{bodyClassName(page.class, names)}</PropertyRow>
          )}
          {page.size !== null && !offers.planetFields && (
            <PropertyRow label="Size">{page.size}</PropertyRow>
          )}
        </Properties>
      )}
      {SECTIONS.map(({ id, Component }) => (
        <Component key={id} page={page} offers={offers} target={target} radius={radius} />
      ))}
      {(starBlock || hasFields(fields) || editsAny || orbitable) && <EditKey />}
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
