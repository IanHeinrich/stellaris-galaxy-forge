import { useEffect } from "react";
import type { Bounds } from "../../../generated/Bounds";
import type { PlanetSummary } from "../../../generated/PlanetSummary";
import type { SystemDetails } from "../../../generated/SystemDetails";
import {
  bodyClassName,
  bodyName,
  boundsText,
  stepText,
  turnText,
} from "../../../lib/details/labels";
import { ANY_ANGLE, isStar, systemLayout } from "../../../lib/details/orbits";
import { resourceRows } from "../../../lib/details/resources";
import { useDetailsStore, useSystemRoll } from "../../../store/detailsStore";
import { moonScaleOf, useGameDataStore } from "../../../store/gameDataStore";
import { useInspectorStore, type Entry } from "../../../store/inspectorStore";
import { useSceneStore } from "../../../store/sceneStore";
import { Chip } from "../../parts";
import { DrillLink, Empty, Properties, PropertyRow, Section } from "../parts";
import { StarRowIcon } from "../StarIcon";
import { PlanetIcon, PlanetSize, Pills } from "../system/sections/bodies";
import { PlanetRow } from "../system/sections/Planets";
import "./entity.css";

/** `16`, or `10–20` for a value the game rolls between two bounds; `random` for none given. */
function rangeText(bounds: Bounds | null): string {
  return bounds === null ? "random" : boundsText(bounds);
}

function Head({ name, body }: { name: string; body: PlanetSummary | null }) {
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const starClasses = useGameDataStore((s) => s.starClasses);
  const own = body?.star_class === undefined ? undefined : starClasses.get(body.star_class);
  const star = body !== null && isStar(body, planetClasses);
  return (
    <div className={`ins-head${star ? " ins-star-head" : " pl-head"}`}>
      {body !== null &&
        (star ? (
          own && <StarRowIcon view={own} />
        ) : (
          <PlanetIcon
            planetClass={body.class}
            sprite={planetClasses.get(body.class)?.icon_sprite}
            seed={body.id}
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
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const moonScale = useGameDataStore(moonScaleOf);
  const shown = useSceneStore((s) =>
    s.scene.kind === "system" && s.scene.id === details.id ? s.roll : 0,
  );
  const roll = useSystemRoll(details.id, shown);
  const placed = systemLayout(details, roll, planetClasses, moonScale).bodies;
  const layout = body.layout;
  const orbitStep = layout?.orbit_step ?? null;
  // A body at the centre of the walk marks no direction to turn from, so it anchors no turn.
  const anchorId = placed.find((p) => p.id === body.id)?.turn?.anchor ?? null;
  const anchor = details.planets.find((p) => p.id === anchorId);
  const anchorRadius = placed.find((p) => p.id === anchorId)?.ring?.radius ?? 0;
  const size = layout?.size ?? (body.size === null ? null : { min: body.size, max: body.size });
  return (
    <>
      <Head name={bodyName(body, names)} body={body} />
      <Properties>
        <PropertyRow label="Class">
          {body.drawn ? "random" : bodyClassName(body.class, names)}
        </PropertyRow>
        {size !== null && (
          <PropertyRow label="Size">
            <PlanetSize size={rangeText(size)} />
          </PropertyRow>
        )}
        {!isStar(body, planetClasses) && (
          <PropertyRow label="Ring">{ringText(body.ring)}</PropertyRow>
        )}
        {body.parent !== null && <Orbits details={details} parent={body.parent} />}
        <PropertyRow label="Orbit radius">{rangeText(layout?.orbit ?? null)}</PropertyRow>
        {orbitStep && <PropertyRow label="Orbit step">{stepText(orbitStep)}</PropertyRow>}
        {orbitStep && (
          <PropertyRow label="Angle step">
            {turnText(layout?.angle_step ?? ANY_ANGLE)}
            {anchor && anchorRadius > 0 && (
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
