import { useEffect } from "react";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useInspectorStore } from "../../../store/inspectorStore";
import { useScriptsStore } from "../../../store/scriptsStore";
import { SourceChip } from "../../parts";
import type { OverviewProps } from "./overviewSections";
import { BeltSection } from "./sections/Belts";
import { FlagsSection } from "./sections/Flags";
import { FleetSection } from "./sections/Fleets";
import { BypassSection, HyperlaneSection } from "./sections/Hyperlanes";
import { InitializerSection } from "./sections/InitializerSection";
import { MegastructureSection } from "./sections/Megastructures";
import { PlanetSection } from "./sections/Planets";
import { ResourceSection } from "./sections/Resources";
import { FeLinksSection } from "./sections/scenario/FeLinksSection";
import { FeZoneSection } from "./sections/scenario/FeZoneSection";
import { MarauderSection } from "./sections/scenario/MarauderSection";
import { SCRIPTS_TAB_TITLE } from "./sections/scenario/ScriptsTab";
import { SpawnPointSection } from "./sections/scenario/SpawnPointSection";
import { SiteSection } from "./sections/Sites";
import { StationSection } from "./sections/Station";
import { WormholePairSection } from "./sections/WormholePair";

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

export function Scripts({ detail }: OverviewProps) {
  const ready = useGameDataStore((s) => s.status === "ready");
  return ready ? <ScriptsRow system={detail.system.id} /> : null;
}

export function Lanes({ detail }: OverviewProps) {
  return <HyperlaneSection detail={detail} limit={OVERVIEW_LANES} />;
}

export function ClosedLanes({ detail }: OverviewProps) {
  return <HyperlaneSection detail={detail} limit={OVERVIEW_LANES} startClosed />;
}

export function Bypasses({ detail }: OverviewProps) {
  return <BypassSection system={detail.system.id} />;
}

export function WormholePair({ detail }: OverviewProps) {
  return <WormholePairSection system={detail.system.id} />;
}

export function SpawnPoint({ detail }: OverviewProps) {
  return <SpawnPointSection system={detail.system} />;
}

export function FeZone({ detail }: OverviewProps) {
  return <FeZoneSection system={detail.system} />;
}

export function FeLinks({ detail }: OverviewProps) {
  return <FeLinksSection system={detail.system} />;
}

export function Marauder({ detail }: OverviewProps) {
  return <MarauderSection system={detail.system} />;
}

/** The initializer lists the bodies it places only while the system's own list is empty. */
export function SpawningInitializer({ detail, details }: OverviewProps) {
  const planets = details?.planets.length ?? 0;
  return <InitializerSection system={detail.system} spawn={planets === 0} />;
}

export function Initializer({ detail }: OverviewProps) {
  return <InitializerSection system={detail.system} spawn={false} />;
}

export function Planets({ details }: OverviewProps) {
  return details ? <PlanetSection details={details} /> : null;
}

/** The bodies, or, where there are none, the resources alone: the initializer lists the rest. */
export function PlanetsOrResources({ details }: OverviewProps) {
  if (!details) return null;
  if (details.planets.length > 0) return <PlanetSection details={details} />;
  return <ResourceSection details={details} />;
}

export function Belts({ details }: OverviewProps) {
  return details ? <BeltSection details={details} /> : null;
}

export function Station({ detail, details }: OverviewProps) {
  if (!details?.starbase) return null;
  return <StationSection starbase={details.starbase} system={detail.system.id} />;
}

export function Megastructures({ detail, details }: OverviewProps) {
  if (!details) return null;
  return <MegastructureSection megastructures={details.megastructures} system={detail.system.id} />;
}

export function Sites({ details }: OverviewProps) {
  if (!details || details.sites.length === 0) return null;
  return <SiteSection sites={details.sites} />;
}

export function MilitaryFleets({ detail, details }: OverviewProps) {
  const fleets = details?.fleets_present.filter((f) => f.military) ?? [];
  return (
    <FleetSection
      id="system.military"
      title="Military fleets"
      fleets={fleets}
      system={detail.system.id}
    />
  );
}

export function UtilityFleets({ detail, details }: OverviewProps) {
  const fleets = details?.fleets_present.filter((f) => !f.military) ?? [];
  return (
    <FleetSection
      id="system.utility"
      title="Utility ships"
      fleets={fleets}
      system={detail.system.id}
    />
  );
}

export function Flags({ detail }: OverviewProps) {
  return <FlagsSection system={detail.system} />;
}

export function FlagsIfAny({ detail }: OverviewProps) {
  return detail.system.flags.length > 0 ? <FlagsSection system={detail.system} /> : null;
}
