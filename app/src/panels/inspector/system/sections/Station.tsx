import type { StarbaseSummary } from "../../../../generated/StarbaseSummary";
import type { Waystation } from "../../../../generated/Waystation";
import { formatPower } from "../../../../lib/details/fleets";
import {
  isWaystationLevel,
  starbaseKeys,
  starbaseLabel,
  waystationType,
} from "../../../../lib/details/labels";
import { capabilityFor } from "../../../../lib/entities";
import { templateName } from "../../../../lib/names";
import { useCountryName } from "../../../../store/browserRows";
import { useGalaxyStore } from "../../../../store/galaxyStore";
import { useGameDataStore } from "../../../../store/gameDataStore";
import { useOpenEntity } from "../../entity/useEntity";
import { Chip, Icon } from "../../../parts";
import { DrillRow, FocusButton, Section, Swatch } from "../../parts";

/** `research · Wayline network 2 · 3 stations`; a system the save lists no station in names its type alone. */
function waystationLine(
  kind: string,
  system: number,
  waystations: readonly Waystation[],
): string | null {
  const pieces: string[] = [];
  const type = waystationType(kind);
  if (type !== null) pieces.push(type);
  const here = waystations.find((w) => w.system === system);
  if (here !== undefined) {
    const stations = waystations.filter((w) => w.network === here.network).length;
    pieces.push(
      `Wayline network ${here.network}`,
      `${stations} station${stations === 1 ? "" : "s"}`,
    );
  }
  return pieces.length === 0 ? null : pieces.join(" · ");
}

export function StationSection({
  starbase,
  system,
}: {
  starbase: StarbaseSummary;
  system: number;
}) {
  const levels = useGameDataStore((s) => s.starbaseLevels);
  const countries = useGalaxyStore((s) => s.countries);
  const waystations = useGalaxyStore((s) => s.waystations);
  const ownerName = useCountryName(starbase.owner);
  const opener = useOpenEntity();
  const owner = starbase.owner === null ? undefined : countries.get(starbase.owner);
  const name = templateName(starbase);
  const level = starbaseLabel(starbase.level);
  const waystation = isWaystationLevel(starbase.level);
  const network = waystation ? waystationLine(starbase.kind, system, waystations) : null;
  return (
    <Section id="system.station" title="Station">
      <DrillRow
        requires={capabilityFor("starbase")}
        onOpen={() => opener.open({ kind: "starbase", id: starbase.id }, name)}
      >
        <Icon className="stn" keys={starbaseKeys(starbase.level, levels, owner)} glyph="◉" />
        <span>
          <span className="l1">
            <Swatch owner={starbase.owner} />
            {waystation ? level : name}
            {!waystation && <Chip>{level}</Chip>}
            {starbase.shipyard && <Chip>shipyard</Chip>}
          </span>
          <span className="l2">
            {waystation ? (
              network !== null && <span>{network}</span>
            ) : (
              <>
                {ownerName ?? "unowned"}
                <span>
                  {starbase.modules.length} modules · {starbase.buildings.length} buildings
                </span>
                {starbase.max_hull > 0 && (
                  <span title="Hull of the station ship">
                    {formatPower(starbase.hull)} / {formatPower(starbase.max_hull)} hull
                  </span>
                )}
              </>
            )}
          </span>
        </span>
        <FocusButton name={name} system={system} />
      </DrillRow>
    </Section>
  );
}
