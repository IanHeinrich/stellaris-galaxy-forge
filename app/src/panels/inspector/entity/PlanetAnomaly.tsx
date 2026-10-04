import { useEffect } from "react";
import type { PlanetPageAnomaly } from "../../../generated/PlanetPageAnomaly";
import type { PickerTarget } from "../../../lib/details/picker";
import { templateName } from "../../../lib/names";
import { useAnomalyPickerStore } from "../../../store/anomalyPickerStore";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useNamed } from "../../useNamed";
import { Icon } from "../../parts";
import { PropertyRow, Section } from "../parts";
import { PickedRow } from "./PickedRow";
import { ANOMALY_PICKER } from "./AnomalyPicker";
import { PlanetPicker } from "./PlanetPicker";
import type { PlanetSectionProps } from "./planetSection";

/** Who has found `anomaly`: "found by …", or "not found yet". */
function useFinders(anomaly: PlanetPageAnomaly): string {
  const countries = useGalaxyStore((s) => s.countries);
  const finders = anomaly.found_by.map((id) => {
    const country = countries.get(id);
    return country === undefined ? `country #${id}` : templateName(country);
  });
  return finders.length === 0 ? "not found yet" : `found by ${finders.join(", ")}`;
}

/** The anomaly waiting on the planet, by the name the game gives its category, and who found it. */
export function AnomalyRow({ anomaly }: { anomaly: PlanetPageAnomaly }) {
  const named = useNamed([anomaly.category]);
  const found = useFinders(anomaly);
  return (
    <PropertyRow label="Anomaly">
      {named(anomaly.category)}
      <span className="muted">
        {" · "}
        {found}
      </span>
    </PropertyRow>
  );
}

/**
 * The anomaly as the Anomaly section lists it: its name, who found it, the game's description of
 * it once the anomaly choices are read, and its remove button.
 */
function AnomalyRowView({ anomaly, target }: { anomaly: PlanetPageAnomaly; target: PickerTarget }) {
  const named = useNamed([anomaly.category]);
  const found = useFinders(anomaly);
  const name = named(anomaly.category);
  const ready = useGameDataStore((s) => s.status === "ready");
  const description = useAnomalyPickerStore(
    (s) => s.choices?.list.find((c) => c.key === anomaly.category)?.description ?? null,
  );
  useEffect(() => {
    if (ready) useAnomalyPickerStore.getState().load(target);
  }, [ready, target]);
  return (
    <PickedRow
      art={<Icon keys={[]} glyph="?" />}
      name={name}
      lines={[
        { className: "l2", text: found },
        ...(ready && description !== null
          ? [{ className: "pl-anomaly-desc" as const, text: description }]
          : []),
      ]}
      remove={{
        title: "Remove this anomaly",
        label: `Remove ${name}`,
        run: () => void target.edits.removeAnomaly(),
      }}
    />
  );
}

/**
 * The body's anomaly as the page's target holds it, with its remove button, or the picker that
 * adds one; where the page offers anomalies.
 */
export function PlanetAnomaly({ offers, target }: PlanetSectionProps) {
  if (!offers.anomaly) return null;
  return (
    <Section id="planet.anomaly" title="Anomaly">
      {target.anomaly === null ? (
        <PlanetPicker kind={ANOMALY_PICKER} target={target} />
      ) : (
        <AnomalyRowView anomaly={target.anomaly} target={target} />
      )}
    </Section>
  );
}
