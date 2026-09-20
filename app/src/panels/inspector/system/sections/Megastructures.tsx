import { useState } from "react";
import type { MegastructureSummary } from "../../../../generated/MegastructureSummary";
import { MEGASTRUCTURE_ICON_KEY } from "../../../../lib/details/icons";
import { isGatewayMegastructure, megastructureParts } from "../../../../lib/details/labels";
import { templateName } from "../../../../lib/names";
import { useDetailsStore } from "../../../../store/detailsStore";
import { useCountryName } from "../../../../store/browserRows";
import { useGalaxyStore } from "../../../../store/galaxyStore";
import { useGameDataStore } from "../../../../store/gameDataStore";
import { useInspectorStore } from "../../../../store/inspectorStore";
import { Chip, DrillRow, FocusButton, Icon, MoreButton, Section, Swatch } from "../../parts";
import { gatewayActive, LIST_LIMIT } from "../../rows";

function MegastructureRowView({
  megastructure,
  system,
}: {
  megastructure: MegastructureSummary;
  system: number;
}) {
  const owner = useCountryName(megastructure.owner);
  const galaxy = useGalaxyStore((s) => s.galaxy);
  const bypasses = galaxy?.bypasses ?? [];
  const names = useGameDataStore((s) => s.names);
  const open = useInspectorStore((s) => s.open);
  const orbits = useDetailsStore((s) =>
    megastructure.planet === null
      ? undefined
      : s.details.get(system)?.planets.find((p) => p.id === megastructure.planet),
  );
  const parsed = megastructureParts(megastructure.kind);
  const name = names.get(megastructure.kind) ?? parsed.name;
  const gateway = isGatewayMegastructure(megastructure.kind);
  const state = gateway ? (gatewayActive(bypasses, system) ? "active" : "inactive") : parsed.state;
  return (
    <DrillRow
      requires="details"
      onOpen={() => open({ ref: { kind: "megastructure", id: megastructure.id }, label: name })}
    >
      <Icon className="pi mega" keys={[MEGASTRUCTURE_ICON_KEY]} glyph="◈" />
      <span>
        <span className="l1">
          <Swatch owner={megastructure.owner} />
          {name}
          {state && <Chip warn={parsed.warn && !gateway}>{state}</Chip>}
        </span>
        <span className="l2">
          {owner ?? "unowned"}
          {megastructure.planet !== null && (
            <span>
              around {orbits === undefined ? `#${megastructure.planet}` : templateName(orbits)}
            </span>
          )}
        </span>
      </span>
      <FocusButton name={name} system={system} />
    </DrillRow>
  );
}

export function MegastructureSection({
  megastructures,
  system,
}: {
  megastructures: MegastructureSummary[];
  system: number;
}) {
  const [all, setAll] = useState(false);
  if (megastructures.length === 0) return null;
  const shown = all ? megastructures : megastructures.slice(0, LIST_LIMIT);
  return (
    <Section id="system.megastructures" title="Megastructures" count={megastructures.length}>
      {shown.map((m) => (
        <MegastructureRowView key={m.id} megastructure={m} system={system} />
      ))}
      {!all && megastructures.length > LIST_LIMIT && (
        <MoreButton count={megastructures.length - LIST_LIMIT} onClick={() => setAll(true)} />
      )}
    </Section>
  );
}
