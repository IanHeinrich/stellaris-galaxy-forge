import type { Bounds } from "../../../generated/Bounds";
import type { PlanetSummary } from "../../../generated/PlanetSummary";
import type { SystemDetails } from "../../../generated/SystemDetails";
import { bodyName, stepText, turnText } from "../../../lib/details/labels";
import { rangeText } from "./bodyFields";
import { ANY_ANGLE, systemLayout } from "../../../lib/details/orbits";
import { counted } from "../../../lib/text";
import { openSystem } from "../../../store/commands";
import { useSystemRoll } from "../../../store/detailsStore";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { moonScaleOf, useGameDataStore } from "../../../store/gameDataStore";
import { useInspectorStore } from "../../../store/inspectorStore";
import { useSceneStore } from "../../../store/sceneStore";
import { DrillLink, LinkRow, Properties, PropertyRow } from "../parts";
import { openBody } from "./openBody";
import { AnomalyRow } from "./PlanetAnomaly";
import { CountryRow } from "./PlanetColony";
import type { PlanetSectionProps } from "./planetSection";
import { useSystemBodyNamer } from "./useBodyName";

/** What the body orbits, opening its page, and its radius where no row of its own gives it. */
function Orbits({
  system,
  parent,
  radius,
}: {
  system: number;
  parent: number;
  radius: Bounds | null;
}) {
  const name = useSystemBodyNamer(system)(parent) ?? `#${parent}`;
  return (
    <PropertyRow label="Orbits">
      <DrillLink
        title="Open the page of the body it orbits"
        onOpen={() => openBody(system, parent, name)}
      >
        {name}
      </DrillLink>
      {radius !== null && <span className="muted"> radius {rangeText(radius)}</span>}
    </PropertyRow>
  );
}

/**
 * The body an initializer body's angle turns from, named with its radius in the roll the system
 * view draws, since siblings share a name: opening its page, and brightening it in the view on hover.
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

/** How far out and how far round an initializer steps the body from the one before it. */
function Steps({
  details,
  body,
  step,
}: {
  details: SystemDetails;
  body: PlanetSummary;
  step: Bounds;
}) {
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const moonScale = useGameDataStore(moonScaleOf);
  const shown = useSceneStore((s) =>
    s.scene.kind === "system" && s.scene.id === details.id ? s.roll : 0,
  );
  const roll = useSystemRoll(details.id, shown);
  const placed = systemLayout(details, roll, planetClasses, moonScale).bodies;
  // A body at the centre of the walk marks no direction to turn from, so it anchors no turn.
  const anchorId = placed.find((p) => p.id === body.id)?.turn?.anchor ?? null;
  const anchor = details.planets.find((p) => p.id === anchorId);
  const anchorRadius = placed.find((p) => p.id === anchorId)?.ring?.radius ?? 0;
  return (
    <>
      <PropertyRow label="Orbit step">{stepText(step)}</PropertyRow>
      <PropertyRow label="Angle step">
        {turnText(body.layout?.angle_step ?? ANY_ANGLE)}
        {anchor && anchorRadius > 0 && (
          <>
            {" from "}
            <Anchor details={details} anchor={anchor} radius={anchorRadius} />
          </>
        )}
      </PropertyRow>
    </>
  );
}

/** What the page only shows: where the body is, and what a save knows of who found and holds it. */
export function PlanetAbout({ read, offers, orbitEdited }: PlanetSectionProps) {
  const systemName = useGalaxyStore((s) => s.systemName);
  const { details, summary, page, parent } = read;
  const anomaly = read.rows.anomaly;
  const orbit = summary.layout?.orbit ?? null;
  const step = summary.layout?.orbit_step ?? null;
  const occupied = page !== null && page.controller !== null && page.controller !== page.owner;
  return (
    <>
      <div className="edit-block-title ins-about">About</div>
      <Properties>
        <LinkRow
          label="System"
          title="Open the system's page"
          onOpen={() => openSystem(details.id)}
        >
          {systemName(details.id)}
        </LinkRow>
        {parent !== null && (
          <Orbits
            system={details.id}
            parent={parent}
            radius={read.orbitRow || orbitEdited ? null : orbit}
          />
        )}
        {read.orbitRow && !orbitEdited && (
          <PropertyRow label="Orbit radius">{rangeText(orbit)}</PropertyRow>
        )}
        {!orbitEdited && step !== null && <Steps details={details} body={summary} step={step} />}
        {page?.surveyed_by != null && <CountryRow label="Surveyed by" id={page.surveyed_by} />}
        {anomaly !== null && !offers.anomaly && <AnomalyRow anomaly={anomaly} />}
        {occupied && page.controller !== null && (
          <CountryRow label="Controller" id={page.controller} />
        )}
        {page !== null && page.flags > 0 && (
          <PropertyRow label="Flags">{counted(page.flags, "flag")}</PropertyRow>
        )}
      </Properties>
    </>
  );
}
