import { bodyName } from "../../../lib/details/labels";
import { capabilityFor } from "../../../lib/entities";
import { templateName } from "../../../lib/names";
import { thousands } from "../../../lib/text";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { Icon } from "../../parts";
import { DrillLink, LinkRow, Properties, PropertyRow, Section, Swatch } from "../parts";
import type { PlanetSectionProps } from "./planetSection";
import { RemoveColonyAction } from "./PlanetRemoval";
import { useOpenEntity } from "./useEntity";

/** A row naming a country, whose name opens its page. */
export function CountryRow({ label, id }: { label: string; id: number }) {
  const opener = useOpenEntity();
  const country = useGalaxyStore((s) => s.countries.get(id));
  const name = country === undefined ? `country #${id}` : templateName(country);
  return (
    <PropertyRow label={label}>
      <span className="pl-country">
        <Swatch owner={id} />
        <DrillLink
          requires={capabilityFor("country")}
          title="Open the empire's page"
          onOpen={() => opener.open({ kind: "country", id }, name)}
        >
          {name}
        </DrillLink>
      </span>
    </PropertyRow>
  );
}

/** The colony's facts, and its removal through the target's adapter where the page offers it. */
export function PlanetColony({ page, offers, target }: PlanetSectionProps) {
  const colonyTypes = usePlanetDataStore((s) => s.colonyTypes);
  const names = useGameDataStore((s) => s.names);
  const opener = useOpenEntity();
  const colony = page.colony;
  if (colony === null || page.owner === null) return null;
  const designation = colony.final_designation ?? colony.designation;
  const type = designation === null ? undefined : colonyTypes.get(designation);
  const split = colony.species.map(
    (s) =>
      `${s.name.key === "" ? `species #${s.id}` : templateName({ name: s.name, name_key: s.name.key })} ${thousands(s.pops)}`,
  );
  return (
    <Section id="planet.colony" title="Colony">
      <Properties>
        <CountryRow label="Owner" id={page.owner} />
        {designation !== null && (
          <PropertyRow label="Designation">
            <span className="pl-designation">
              {type?.icon != null && <Icon className="gi" keys={[type.icon]} />}
              {type?.name ?? designation}
            </span>
          </PropertyRow>
        )}
        {colony.colonised !== null && (
          <PropertyRow label="Colonised">{colony.colonised}</PropertyRow>
        )}
        <PropertyRow label="Pops">{[thousands(colony.pops), ...split].join(" · ")}</PropertyRow>
        <LinkRow
          label="Colony"
          requires={capabilityFor("colony")}
          title="Open the colony's page"
          onOpen={() => opener.open({ kind: "colony", id: colony.id }, `Colony #${colony.id}`)}
        >
          #{colony.id}
        </LinkRow>
      </Properties>
      {offers.pageRemoval && (
        <RemoveColonyAction page={page} name={bodyName(page, names)} edits={target.edits} />
      )}
    </Section>
  );
}
