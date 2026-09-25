import { useState } from "react";
import type { FleetSummary } from "../../../../generated/FleetSummary";
import { fleetPowerClause } from "../../../../lib/details/fleets";
import { capabilityFor, orderLabel } from "../../../../lib/entities";
import { templateName } from "../../../../lib/names";
import { useCountryName } from "../../../../store/browserRows";
import { useGameDataStore } from "../../../../store/gameDataStore";
import { useOwnerCss } from "../../ownerCss";
import { useOpenEntity } from "../../entity/useEntity";
import { Icon } from "../../../parts";
import { DrillRow, FocusButton, MoreButton, Section, Swatch } from "../../parts";
import { fleetGlyph, fleetIcon, LIST_LIMIT, shipRole, shipSizeChips } from "../../rows";

function FleetBadge({ fleet }: { fleet: FleetSummary }) {
  const shipSizes = useGameDataStore((s) => s.shipSizes);
  const plate = useOwnerCss(fleet.owner);
  const icon = fleetIcon(fleet, shipSizes);
  return (
    <span className="badge" style={{ background: plate ?? "var(--bg-elevated)" }}>
      <Icon keys={icon ? [`sprite:GFX_${icon}`] : []} glyph={fleetGlyph(icon)} />
    </span>
  );
}

function FleetRow({ fleet, system }: { fleet: FleetSummary; system: number }) {
  const owner = useCountryName(fleet.owner);
  const names = useGameDataStore((s) => s.names);
  const opener = useOpenEntity();
  const name = templateName(fleet);
  const detail = fleet.military
    ? `${fleet.ships} ships · ${fleetPowerClause(fleet)}`
    : shipRole(fleet, names);
  return (
    <DrillRow
      requires={capabilityFor("fleet")}
      onOpen={() => opener.open({ kind: "fleet", id: fleet.id }, name)}
    >
      <FleetBadge fleet={fleet} />
      <span>
        <span className="l1">
          <Swatch owner={fleet.owner} />
          {name}
        </span>
        <span className="l2" title={shipSizeChips(fleet, names)}>
          {detail}
          {fleet.order !== null && <span>{orderLabel(fleet.order)}</span>}
          {owner !== null && <span>{owner}</span>}
        </span>
      </span>
      <FocusButton name={name} system={system} />
    </DrillRow>
  );
}

export function FleetSection({
  id,
  title,
  fleets,
  system,
}: {
  id: string;
  title: string;
  fleets: FleetSummary[];
  system: number;
}) {
  const [all, setAll] = useState(false);
  if (fleets.length === 0) return null;
  const shown = all ? fleets : fleets.slice(0, LIST_LIMIT);
  return (
    <Section id={id} title={title} count={fleets.length}>
      {shown.map((f) => (
        <FleetRow key={f.id} fleet={f} system={system} />
      ))}
      {!all && fleets.length > LIST_LIMIT && (
        <MoreButton count={fleets.length - LIST_LIMIT} onClick={() => setAll(true)} />
      )}
    </Section>
  );
}
