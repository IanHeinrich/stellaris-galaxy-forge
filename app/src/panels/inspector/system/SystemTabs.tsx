import type { SystemDetail } from "../../../generated/SystemDetail";
import type { SystemDetails } from "../../../generated/SystemDetails";
import { documentCapabilities } from "../../../lib/capabilities";
import { nodeName } from "../../../lib/names";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { DataTab } from "../entity/DataTab";
import { SourceTab } from "../entity/SourceTab";
import { Empty, Properties, PropertyRow, Section } from "../parts";
import { OVERVIEW_SECTIONS, overviewSectionsFor } from "./overviewSections";
import { FleetSection } from "./sections/Fleets";
import { BypassSection, HyperlaneSection } from "./sections/Hyperlanes";
import { MegastructureSection } from "./sections/Megastructures";
import { PlanetSection } from "./sections/Planets";
import { ScriptsTab } from "./sections/scenario/ScriptsTab";
import { SiteSection } from "./sections/Sites";
import { StationSection } from "./sections/Station";
import { Header, OverviewHead } from "./SystemHeader";

/**
 * The system's Overview: the head, then every section the document can answer for. A document
 * that holds its systems' contents shows them once they are read; one whose bodies are rolled
 * has each section wait for data of its own.
 */
export function Overview({
  detail,
  details,
}: {
  detail: SystemDetail;
  details: SystemDetails | undefined;
}) {
  const capabilities = useFileSessionStore(documentCapabilities);
  if (!capabilities.rolled_layout && !details) {
    return (
      <>
        <OverviewHead detail={detail} />
        <Empty>Reading the system's contents…</Empty>
      </>
    );
  }
  return (
    <>
      <OverviewHead detail={detail} />
      {overviewSectionsFor(capabilities).map((key) => {
        const Entry = OVERVIEW_SECTIONS[key].component;
        return <Entry key={key} detail={detail} details={details} />;
      })}
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
