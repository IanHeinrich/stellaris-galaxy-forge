import type { Bounds } from "../../../generated/Bounds";
import type { PlanetSummary } from "../../../generated/PlanetSummary";
import type { SystemDetails } from "../../../generated/SystemDetails";
import { bodyName, stepText, turnText } from "../../../lib/details/labels";
import { rangeText } from "./bodyFields";
import { ANY_ANGLE } from "../../../lib/details/orbits";
import { listedNameValue } from "../../../lib/details/scenarioValues";
import { setsOrbitStep, valueSources } from "../../../lib/details/spawnFacts";
import { counted } from "../../../lib/text";
import { openSystem } from "../../../store/commands";
import { useSystemRoll } from "../../../store/detailsStore";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useInspectorStore } from "../../../store/inspectorStore";
import { useSceneStore } from "../../../store/sceneStore";
import { useSystemGeometry } from "../../../store/systemGeometry";
import { DrillLink, LinkRow, Properties, PropertyRow } from "../parts";
import { openBody } from "./openBody";
import { AnomalyRow } from "./PlanetAnomaly";
import { CountryRow } from "./PlanetColony";
import type { PlanetSectionProps } from "./planetSection";
import { AngleDial } from "../AngleDial";
import { HintedRow, SetByLines, StateValue } from "../states";
import { useSystemBodyNames } from "../../useBodyName";

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
  const listed = useSystemBodyNames(system)(parent) ?? { text: `#${parent}`, rolled: false };
  const name = listed.text;
  return (
    <PropertyRow label="Orbits">
      <DrillLink
        title="Open the page of the body it orbits"
        onOpen={() => openBody(system, parent, name)}
      >
        <StateValue value={listedNameValue(listed)} />
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
  const listed = useSystemBodyNames(details.id)(anchor.id) ?? {
    text: bodyName(anchor, names),
    rolled: false,
  };
  const name = listed.text;
  return (
    <DrillLink
      title="Open the page of the body its angle turns from"
      onHover={(on) => setLinkedBody(on ? anchor.id : null)}
      onOpen={() => {
        setLinkedBody(null);
        open({ ref: { kind: "body", system: details.id, id: anchor.id }, label: name });
      }}
    >
      <StateValue value={listedNameValue(listed)} />
      {` (orbit ${Math.round(radius)})`}
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
  const shown = useSceneStore((s) =>
    s.scene.kind === "system" && s.scene.id === details.id ? s.roll : 0,
  );
  // Asks for the roll while the system view shows another system; the layout reads it.
  useSystemRoll(details.id, shown);
  const placed = useSystemGeometry(details.id).layout.bodies;
  // A body at the centre of the walk marks no direction to turn from, so it anchors no turn.
  const anchorId = placed.find((p) => p.id === body.id)?.turn?.anchor ?? null;
  const anchor = details.planets.find((p) => p.id === anchorId);
  const anchorRadius = placed.find((p) => p.id === anchorId)?.ring?.radius ?? 0;
  const angle = body.layout?.angle_step ?? ANY_ANGLE;
  const angleVariable = (body.spawn?.variables ?? []).some((v) => v.key === "orbit_angle");
  const stepSources = valueSources(
    {
      inline_scripts: [],
      variables: (body.spawn?.variables ?? []).filter((v) => setsOrbitStep(v.key)),
    },
    body.moon,
  );
  return (
    <>
      <HintedRow
        label="Orbit step"
        hint={stepSources.length === 0 ? null : <SetByLines sources={stepSources} />}
      >
        {stepText(step)}
      </HintedRow>
      <PropertyRow label="Angle step">
        <AngleDial step={angleVariable ? null : angle} />
        {turnText(angle)}
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
