import { useState } from "react";
import type { MegastructureSummary } from "../../../../generated/MegastructureSummary";
import { MEGASTRUCTURE_ICON_KEY } from "../../../../lib/details/icons";
import { isGatewayMegastructure, megastructureParts } from "../../../../lib/details/labels";
import {
  megastructurePageNeeds,
  NO_MEGASTRUCTURES,
  originMark,
  originOf,
} from "../../../../lib/details/placedRows";
import { documentCapabilities, supports } from "../../../../lib/capabilities";
import { templateName } from "../../../../lib/names";
import { useDetailsStore } from "../../../../store/detailsStore";
import { useCountryName } from "../../../../store/browserRows";
import { useFileSessionStore } from "../../../../store/fileSessionStore";
import { useGalaxyStore } from "../../../../store/galaxyStore";
import { useGameDataStore } from "../../../../store/gameDataStore";
import { useOpenEntity } from "../../entity/useEntity";
import { Chip, Icon, OriginMark } from "../../../parts";
import { DrillRow, Empty, FocusButton, MoreButton, Section, Swatch } from "../../parts";
import { gatewayActive, LIST_LIMIT } from "../../rows";

function MegastructureRowView({
  megastructure,
  system,
}: {
  megastructure: MegastructureSummary;
  system: number;
}) {
  const owner = useCountryName(megastructure.owner);
  const bypasses = useGalaxyStore((s) => s.bypasses);
  const names = useGameDataStore((s) => s.names);
  const opener = useOpenEntity();
  const orbits = useDetailsStore((s) =>
    megastructure.planet === null
      ? undefined
      : s.details.get(system)?.planets.find((p) => p.id === megastructure.planet),
  );
  const origin = originOf(megastructure);
  const needs = megastructurePageNeeds(origin);
  const opens = useFileSessionStore(
    (s) => needs !== null && supports(documentCapabilities(s), needs),
  );
  const parsed = megastructureParts(megastructure.kind);
  const name = names.get(megastructure.kind) ?? parsed.name;
  const gateway = isGatewayMegastructure(megastructure.kind);
  const state = gateway ? (gatewayActive(bypasses, system) ? "active" : "inactive") : parsed.state;
  const mark = originMark(origin, opens);
  return (
    <DrillRow
      requires={needs ?? undefined}
      inert={needs === null}
      onOpen={() => opener.open({ kind: "megastructure", id: megastructure.id }, name)}
    >
      <Icon className="pi mega" keys={[MEGASTRUCTURE_ICON_KEY]} glyph="◈" />
      <span>
        <span className="l1">
          <Swatch owner={megastructure.owner} />
          {name}
          {state && <Chip warn={parsed.warn && !gateway}>{state}</Chip>}
          {mark !== null && <OriginMark mark={mark} />}
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

/** The system's megastructures; with none, a line on how to add one where the document can. */
export function MegastructureSection({
  megastructures,
  system,
}: {
  megastructures: MegastructureSummary[];
  system: number;
}) {
  const [all, setAll] = useState(false);
  const addable = useFileSessionStore((s) => documentCapabilities(s).add_megastructures);
  if (megastructures.length === 0 && !addable) return null;
  const shown = all ? megastructures : megastructures.slice(0, LIST_LIMIT);
  return (
    <Section id="system.megastructures" title="Megastructures" count={megastructures.length}>
      {megastructures.length === 0 && <Empty>{NO_MEGASTRUCTURES}</Empty>}
      {shown.map((m) => (
        <MegastructureRowView key={m.id} megastructure={m} system={system} />
      ))}
      {!all && megastructures.length > LIST_LIMIT && (
        <MoreButton count={megastructures.length - LIST_LIMIT} onClick={() => setAll(true)} />
      )}
    </Section>
  );
}
