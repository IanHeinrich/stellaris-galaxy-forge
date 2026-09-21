import { useEffect } from "react";
import type { SystemDetail } from "../../../generated/SystemDetail";
import type { SystemDetails } from "../../../generated/SystemDetails";
import { nodeName } from "../../../lib/names";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useInspectorStore } from "../../../store/inspectorStore";
import { useScriptsStore } from "../../../store/scriptsStore";
import { DataTab } from "../entity/DataTab";
import { SourceTab } from "../entity/SourceTab";
import { Empty, Properties, PropertyRow, Section, SourceChip } from "../parts";
import { FleetSection } from "./sections/Fleets";
import { FlagsSection } from "./sections/Flags";
import { BypassSection, HyperlaneSection } from "./sections/Hyperlanes";
import { InitializerSection } from "./sections/InitializerSection";
import { MegastructureSection } from "./sections/Megastructures";
import { PlanetSection } from "./sections/Planets";
import { ResourceSection } from "./sections/Resources";
import { FeLinksSection } from "./sections/scenario/FeLinksSection";
import { FeZoneSection } from "./sections/scenario/FeZoneSection";
import { MarauderSection } from "./sections/scenario/MarauderSection";
import { ScriptsTab, SCRIPTS_TAB_TITLE } from "./sections/scenario/ScriptsTab";
import { SpawnPointSection } from "./sections/scenario/SpawnPointSection";
import { WormholePairSection } from "./sections/scenario/WormholePairSection";
import { SiteSection } from "./sections/Sites";
import { StationSection } from "./sections/Station";
import { Header, OverviewHead } from "./SystemHeader";

/** How many hyperlanes the Overview lists before sending the reader to the Lanes tab. */
const OVERVIEW_LANES = 5;

/** What the closed row says for the count: still reading, unavailable, or what came back. */
function scriptsCount(
  scripts: { rows: unknown[] } | undefined,
  missing: boolean,
  failed: boolean,
): string {
  if (failed) return "unavailable";
  if (scripts !== undefined) return String(scripts.rows.length);
  return missing ? "0" : "…";
}

/** The closed row the overview ends with: how many scripts reach the system, and the way to them. */
function ScriptsRow({ system }: { system: number }) {
  const setTab = useInspectorStore((s) => s.setTab);
  const request = useScriptsStore((s) => s.request);
  const scripts = useScriptsStore((s) => s.scripts.get(system));
  const missing = useScriptsStore((s) => s.missing.has(system));
  const failed = useScriptsStore((s) => s.failed.has(system));
  const version = useScriptsStore((s) => s.version);

  // The cache bumps its version when it drops what it held, and asking again is how it refills.
  useEffect(() => request(system), [system, request, version]);

  return (
    <button
      type="button"
      className="ins-sec ins-sec-link"
      title={SCRIPTS_TAB_TITLE}
      onClick={() => setTab("scripts")}
    >
      <span className={`ins-sec-title${failed ? " muted" : ""}`}>
        Scripts · {scriptsCount(scripts, missing, failed)}
      </span>
      <SourceChip source="scripts" />
    </button>
  );
}

/**
 * A scenario system holds nothing of its own: its contents are what the initializer will spawn,
 * which the details cache reads from the game data. Each section waits for data of its own, and
 * the initializer lists the bodies only while the planet list does not.
 */
function ScenarioOverview({
  detail,
  details,
}: {
  detail: SystemDetail;
  details: SystemDetails | undefined;
}) {
  const { system } = detail;
  const ready = useGameDataStore((s) => s.status === "ready");
  const planets = details?.planets.length ?? 0;
  return (
    <>
      <OverviewHead detail={detail} />
      <SpawnPointSection system={system} />
      <FeZoneSection system={system} />
      <FeLinksSection system={system} />
      <MarauderSection system={system} />
      <WormholePairSection system={system} />
      <InitializerSection system={system} spawn={planets === 0} />
      {details &&
        (planets > 0 ? <PlanetSection details={details} /> : <ResourceSection details={details} />)}
      {details?.starbase && <StationSection starbase={details.starbase} system={system.id} />}
      {details && (
        <MegastructureSection megastructures={details.megastructures} system={system.id} />
      )}
      <BypassSection system={system.id} />
      {details && details.sites.length > 0 && <SiteSection sites={details.sites} />}
      {system.flags.length > 0 && <FlagsSection flags={system.flags} />}
      <HyperlaneSection detail={detail} limit={OVERVIEW_LANES} startClosed />
      {ready && <ScriptsRow system={system.id} />}
    </>
  );
}

export function Overview({
  detail,
  details,
}: {
  detail: SystemDetail;
  details: SystemDetails | undefined;
}) {
  const scenario = useFileSessionStore((s) => s.kind === "scenario");
  const { system } = detail;
  if (scenario) return <ScenarioOverview detail={detail} details={details} />;
  if (!details) {
    return (
      <>
        <OverviewHead detail={detail} />
        <Empty>Reading the system's contents…</Empty>
      </>
    );
  }
  const military = details.fleets_present.filter((f) => f.military);
  const utility = details.fleets_present.filter((f) => !f.military);
  return (
    <>
      <OverviewHead detail={detail} />
      <HyperlaneSection detail={detail} limit={OVERVIEW_LANES} />
      <BypassSection system={system.id} />
      <PlanetSection details={details} />
      {details.starbase && <StationSection starbase={details.starbase} system={system.id} />}
      <MegastructureSection megastructures={details.megastructures} system={system.id} />
      <FleetSection
        id="system.military"
        title="Military fleets"
        fleets={military}
        system={system.id}
      />
      <FleetSection id="system.utility" title="Utility ships" fleets={utility} system={system.id} />
      <FlagsSection flags={system.flags} />
      <InitializerSection system={system} spawn={false} />
    </>
  );
}

export function Contents({
  detail,
  details,
  failed,
}: {
  detail: SystemDetail;
  details: SystemDetails | undefined;
  failed: string | undefined;
}) {
  if (failed !== undefined || !details) return <Empty>{contentsText(failed)}</Empty>;
  const military = details.fleets_present.filter((f) => f.military);
  const utility = details.fleets_present.filter((f) => !f.military);
  return (
    <>
      <Header detail={detail} />
      <PlanetSection details={details} />
      {details.starbase && <StationSection starbase={details.starbase} system={detail.system.id} />}
      <MegastructureSection megastructures={details.megastructures} system={detail.system.id} />
      <FleetSection
        id="system.military"
        title="Military fleets"
        fleets={military}
        system={detail.system.id}
      />
      <FleetSection
        id="system.utility"
        title="Utility ships"
        fleets={utility}
        system={detail.system.id}
      />
      <SiteSection sites={details.sites} />
    </>
  );
}

/** What stands in for the contents: still reading, or why the reading failed. */
function contentsText(failed: string | undefined): string {
  if (failed !== undefined) return `The contents could not be read: ${failed}`;
  return "Reading the system's contents…";
}

export function Scripts({ detail }: { detail: SystemDetail }) {
  return (
    <>
      <Header detail={detail} />
      <ScriptsTab system={detail.system.id} />
    </>
  );
}

export function Lanes({ detail }: { detail: SystemDetail }) {
  return (
    <>
      <Header detail={detail} />
      <HyperlaneSection detail={detail} />
      <BypassSection system={detail.system.id} />
      <Section id="system.nebula" title="Nebula">
        {detail.nebula ? (
          <Properties>
            <PropertyRow label="Name">{nodeName(detail.nebula.name)}</PropertyRow>
            <PropertyRow label="Radius">{detail.nebula.radius}</PropertyRow>
            <PropertyRow label="Systems">{detail.nebula.systems.length}</PropertyRow>
          </Properties>
        ) : (
          <Empty>This system is not in a nebula.</Empty>
        )}
      </Section>
    </>
  );
}

export function Data({ detail }: { detail: SystemDetail }) {
  return (
    <>
      <Header detail={detail} />
      <DataTab addr={{ kind: "system", id: detail.system.id }} path={[]} />
    </>
  );
}

export function Source({ detail }: { detail: SystemDetail }) {
  return (
    <>
      <Header detail={detail} />
      <SourceTab addr={{ kind: "system", id: detail.system.id }} />
    </>
  );
}
