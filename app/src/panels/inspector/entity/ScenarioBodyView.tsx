import { useEffect } from "react";
import type { Bounds } from "../../../generated/Bounds";
import type { PlanetSummary } from "../../../generated/PlanetSummary";
import type { SystemDetails } from "../../../generated/SystemDetails";
import { bodyClassName, bodyName } from "../../../lib/details/labels";
import { ANY_ANGLE, rolledRadii, rollSeed, stepText, turnText } from "../../../lib/details/orbits";
import { resourceRows } from "../../../lib/details/resources";
import type { ResolvedClass } from "../../../lib/details/bodyClass";
import { useDetailsStore } from "../../../store/detailsStore";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useInspectorStore, type Entry } from "../../../store/inspectorStore";
import { useSceneStore } from "../../../store/sceneStore";
import { Chip } from "../../parts";
import { DrillLink, Empty, Properties, PropertyRow, Section } from "../parts";
import { StarRowIcon } from "../StarIcon";
import { PlanetIcon, PlanetSize, Pills } from "../system/sections/bodies";
import { PlanetRow } from "../system/sections/Planets";
import { useResolvedClass } from "./useBodyClasses";
import "./entity.css";

/** `16`, or `10–20` for a value the game rolls between two bounds; `random` for none given. */
function boundsText(bounds: Bounds | null): string {
  if (bounds === null) return "random";
  const { min, max } = bounds;
  return min === max ? `${min}` : `${min}–${max}`;
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

/** Where `anchor` stands in roll `roll` of its system, as the system view draws it. */
function rolledRadius(details: SystemDetails, anchor: PlanetSummary, roll: number): number {
  const rolled = rolledRadii(details.planets, rollSeed(details.id, roll)).get(anchor.id);
  const orbit = anchor.layout?.orbit;
  return rolled?.radius ?? (orbit ? (orbit.min + orbit.max) / 2 : 0);
}

/** A scenario body's `has_ring`: stated, or left to its class's chance. */
function ringText(ring: boolean | null): string {
  if (ring === null) return "Rolled by the game";
  return ring ? "Yes" : "No";
}

/**
 * The body a scenario body's angle turns from, named with its radius in the roll the system view
 * draws, since siblings share a name: opening its page, and brightening it in the view on hover.
 */
function Anchor({
  details,
  anchor,
  radius,
}: {
  details: SystemDetails;
  anchor: PlanetSummary;
  radius: number;
}) {
  const names = useGameDataStore((s) => s.names);
  const open = useInspectorStore((s) => s.open);
  const setLinkedBody = useSceneStore((s) => s.setLinkedBody);
  const name = bodyName(anchor, names);
  return (
    <DrillLink
      title="Open the page of the body its angle turns from"
      onHover={(on) => setLinkedBody(on ? anchor.id : null)}
      onOpen={() => {
        setLinkedBody(null);
        open({ ref: { kind: "body", system: details.id, id: anchor.id }, label: name });
      }}
    >
      {`${name} at ${Math.round(radius)}`}
    </DrillLink>
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
  const layout = body.layout;
  const orbitStep = scenario ? (layout?.orbit_step ?? null) : null;
  const angleStep = scenario ? (layout?.angle_step ?? null) : null;
  const roll = useSceneStore((s) =>
    s.scene.kind === "system" && s.scene.id === details.id ? s.roll : 0,
  );
  const turnsFrom = layout?.turns_from ?? null;
  const anchor = turnsFrom === null ? undefined : details.planets.find((p) => p.id === turnsFrom);
  // A body at the centre of the walk marks no direction to turn from.
  const anchorRadius = anchor ? rolledRadius(details, anchor, roll) : 0;
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
        {resolved?.star !== true && <PropertyRow label="Ring">{ringText(body.ring)}</PropertyRow>}
        {body.parent !== null && <Orbits details={details} parent={body.parent} />}
        <PropertyRow label="Orbit radius">{boundsText(layout?.orbit ?? null)}</PropertyRow>
        {orbitStep && <PropertyRow label="Orbit step">{stepText(orbitStep)}</PropertyRow>}
        {scenario && (
          <PropertyRow label="Angle step">
            {turnText(angleStep ?? ANY_ANGLE)}
            {angleStep && anchor && anchorRadius > 0 && (
              <>
                {" from "}
                <Anchor details={details} anchor={anchor} radius={anchorRadius} />
              </>
            )}
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
