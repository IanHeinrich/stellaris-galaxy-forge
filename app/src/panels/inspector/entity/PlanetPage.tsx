import { useEffect, useMemo } from "react";
import type { PlanetPage } from "../../../generated/PlanetPage";
import type { PlanetPageMoon } from "../../../generated/PlanetPageMoon";
import { bodyClassName, bodyName } from "../../../lib/details/labels";
import { findPlanet, isStarBody, starBodyEditable } from "../../../lib/details/starBody";
import {
  daysLeft,
  modifierRows,
  planetDataKeys,
  type ModifierRow,
} from "../../../lib/details/planetPage";
import { capabilityFor } from "../../../lib/entities";
import { templateName } from "../../../lib/names";
import { counted, thousands } from "../../../lib/text";
import { useDetailsStore } from "../../../store/detailsStore";
import { useCanEdit } from "../../../store/fileSessionStore";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useInspectorStore, type Entry } from "../../../store/inspectorStore";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { EditKey } from "../../EditField";
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
import { PlanetDeposits } from "./PlanetDeposits";
import { StarBlock } from "./StarBlock";
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

function ModifierRowView({ row }: { row: ModifierRow }) {
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
    </div>
  );
}

function PlanetModifiers({ page }: { page: PlanetPage }) {
  const views = usePlanetDataStore((s) => s.modifiers);
  const rows = modifierRows(page, views);
  if (rows.length === 0) return null;
  return (
    <Section id="planet.modifiers" title="Modifiers" count={rows.length}>
      {rows.map((row) => (
        <ModifierRowView key={row.key} row={row} />
      ))}
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

function Colony({ page }: { page: PlanetPage }) {
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

function Orbits({ parent, orbit }: { parent: number; orbit: number | null }) {
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
      {orbit !== null && <span className="muted"> radius {orbit}</span>}
    </PropertyRow>
  );
}

function About({ page }: { page: PlanetPage }) {
  const openSystem = useInspectorStore((s) => s.openSystem);
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
        {page.parent !== null && <Orbits parent={page.parent} orbit={page.orbit} />}
        {page.surveyed_by !== null && <CountryRow label="Surveyed by" id={page.surveyed_by} />}
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
            editable={starBodyEditable(summary.class, bodies, planetClasses, starClasses)}
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
  const found = useFoundPlanet(page.id);
  const system = useGalaxyStore((s) => (found === null ? undefined : s.systems.get(found.system)));
  const star = starBodyEditable(page.class, bodies, planetClasses, starClasses);
  const starBlock = star && found !== null && system !== undefined;
  const requestDetails = useDetailsStore((s) => s.request);
  const detailsVersion = useDetailsStore((s) => s.version);
  const waiting = useDetailsStore((s) => page.system !== null && !s.failed.has(page.system));
  // A star's fields need its system's details, which a page reached from search may not have read.
  useEffect(() => {
    if (star && page.system !== null) requestDetails([page.system]);
  }, [star, page.system, requestDetails, detailsVersion]);
  return (
    <>
      <Head page={page} />
      {starBlock ? (
        <StarBlock planet={found.planet} system={system} />
      ) : star && waiting ? (
        <Empty>{READING_STARS}</Empty>
      ) : (
        <Properties>
          <PropertyRow label="Class">{bodyClassName(page.class, names)}</PropertyRow>
          {page.size !== null && <PropertyRow label="Size">{page.size}</PropertyRow>}
        </Properties>
      )}
      <PlanetDeposits page={page} />
      <PlanetModifiers page={page} />
      <Colony page={page} />
      <About page={page} />
      <Moons page={page} />
      {starBlock && <EditKey />}
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
