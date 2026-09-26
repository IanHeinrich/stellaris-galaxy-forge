import { useEffect } from "react";
import type { Bounds } from "../../../generated/Bounds";
import type { PlanetSummary } from "../../../generated/PlanetSummary";
import type { SystemDetails } from "../../../generated/SystemDetails";
import { bodyClassName, bodyName } from "../../../lib/details/labels";
import { bodySteps, stepText, turnText } from "../../../lib/details/orbits";
import { resourceRows } from "../../../lib/details/resources";
import type { ResolvedClass } from "../../../lib/details/bodyClass";
import { useDetailsStore } from "../../../store/detailsStore";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useInspectorStore, type Entry } from "../../../store/inspectorStore";
import { Chip } from "../../parts";
import { DrillLink, Empty, Properties, PropertyRow, Section } from "../parts";
import { StarRowIcon } from "../StarIcon";
import { PlanetIcon, PlanetSize, Pills } from "../system/sections/bodies";
import { PlanetRow } from "../system/sections/Planets";
import { useResolvedClass } from "./useBodyClasses";
import "./entity.css";

/** `16`, or `10–20` for a value the game rolls between two bounds; `random` for none given. */
function boundsText(bounds: Bounds | null, unit = ""): string {
  if (bounds === null) return "random";
  const { min, max } = bounds;
  return min === max ? `${min}${unit}` : `${min}–${max}${unit}`;
}

/** Whether the initializer leaves the body's class to the game. */
function randomClass(planetClass: string): boolean {
  return planetClass === "" || planetClass === "random" || planetClass.startsWith("random_");
}

interface HeadProps {
  name: string;
  body: PlanetSummary | null;
  /** The body's class as the system view draws it. */
  resolved?: ResolvedClass;
}

function Head({ name, body, resolved }: HeadProps) {
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const starClasses = useGameDataStore((s) => s.starClasses);
  const own = resolved?.starClass ? starClasses.get(resolved.starClass) : undefined;
  const star = body !== null && resolved?.star === true;
  return (
    <div className={`ins-head${star ? " ins-star-head" : " pl-head"}`}>
      {body !== null &&
        (star ? (
          own && <StarRowIcon view={own} />
        ) : (
          <PlanetIcon
            planetClass={body.class}
            sprite={planetClasses.get(body.class)?.icon_sprite}
          />
        ))}
      <span className="name">{name}</span>
      {body?.colonised && <Chip>colonised</Chip>}
      {body?.capital && <Chip>capital</Chip>}
      {body?.pre_ftl && <Chip>pre-FTL</Chip>}
    </div>
  );
}

/** The body this one orbits, opening its page. */
function Orbits({ details, parent }: { details: SystemDetails; parent: number }) {
  const names = useGameDataStore((s) => s.names);
  const open = useInspectorStore((s) => s.open);
  const found = details.planets.find((p) => p.id === parent);
  const name = found === undefined ? `#${parent}` : bodyName(found, names);
  return (
    <PropertyRow label="Orbits">
      <DrillLink
        title="Open the page of the body it orbits"
        onOpen={() => open({ ref: { kind: "body", system: details.id, id: parent }, label: name })}
      >
        {name}
      </DrillLink>
    </PropertyRow>
  );
}

function Deposits({ details, body }: { details: SystemDetails; body: PlanetSummary }) {
  const icons = useDetailsStore((s) => s.resourceIcons);
  const rows = resourceRows({ ...details, resources: body.deposits }, icons);
  if (rows.length === 0) return null;
  return (
    <Section id="body.deposits" title="Deposits" count={rows.length}>
      <div className="ins-prow wide">
        <span className="l3">
          <Pills rows={rows} />
        </span>
      </div>
    </Section>
  );
}

function Moons({ details, body }: { details: SystemDetails; body: PlanetSummary }) {
  const moons = details.planets.filter((p) => p.parent === body.id);
  if (moons.length === 0) return null;
  return (
    <Section id="body.moons" title="Moons" count={moons.length}>
      {moons.map((moon) => (
        <PlanetRow
          key={moon.id}
          planet={{ ...moon, moon: false }}
          details={details}
          editHint={null}
        />
      ))}
    </Section>
  );
}

function BodyOverview({ details, body }: { details: SystemDetails; body: PlanetSummary }) {
  const names = useGameDataStore((s) => s.names);
  const resolved = useResolvedClass(details, body.id);
  const scenario = useFileSessionStore((s) => s.kind === "scenario");
  const steps = scenario ? bodySteps(details.planets).get(body.id) : undefined;
  const after =
    steps?.after == null ? undefined : details.planets.find((p) => p.id === steps.after);
  const layout = body.layout;
  const size = layout?.size ?? (body.size === null ? null : { min: body.size, max: body.size });
  return (
    <>
      <Head name={bodyName(body, names)} body={body} resolved={resolved} />
      <Properties>
        <PropertyRow label="Class">
          {randomClass(body.class) ? "random" : bodyClassName(body.class, names)}
        </PropertyRow>
        {size !== null && (
          <PropertyRow label="Size">
            <PlanetSize size={boundsText(size)} />
          </PropertyRow>
        )}
        {body.parent !== null && <Orbits details={details} parent={body.parent} />}
        <PropertyRow label="Orbit radius">{boundsText(layout?.orbit ?? null)}</PropertyRow>
        {steps?.orbit && <PropertyRow label="Orbit step">{stepText(steps.orbit)}</PropertyRow>}
        <PropertyRow label="Angle">{boundsText(layout?.angle ?? null, "°")}</PropertyRow>
        {steps?.angle && (
          <PropertyRow label="Angle step">
            {turnText(steps.angle)}
            {after && ` from ${bodyName(after, names)}`}
          </PropertyRow>
        )}
      </Properties>
      <Deposits details={details} body={body} />
      <Moons details={details} body={body} />
    </>
  );
}

/** A scenario body's Overview, read from its system's details; it has no entity to read. */
export function ScenarioBodyView({ entry }: { entry: Entry }) {
  const ref = entry.ref;
  const system = ref.kind === "body" ? ref.system : null;
  const details = useDetailsStore((s) => (system === null ? undefined : s.details.get(system)));
  const request = useDetailsStore((s) => s.request);
  const version = useDetailsStore((s) => s.version);
  const failed = useDetailsStore((s) => (system === null ? undefined : s.failed.get(system)));
  useEffect(() => {
    if (system !== null) request([system]);
  }, [system, request, version]);
  const body = ref.kind === "body" ? (details?.planets.find((p) => p.id === ref.id) ?? null) : null;
  if (details === undefined || body === null) {
    return (
      <>
        <Head name={entry.label} body={null} />
        <Empty>
          {details !== undefined
            ? "This body is not in the system any more."
            : (failed ?? "Reading the system…")}
        </Empty>
      </>
    );
  }
  return <BodyOverview details={details} body={body} />;
}
