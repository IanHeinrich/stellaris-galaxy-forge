import type { HeldAnomaly, PickerTarget } from "../../../lib/details/picker";
import type { StatedAnomalies } from "../../../generated/StatedAnomalies";
import { anomalyLine, bodyNoun, placedAnomaly } from "../../../lib/details/spawnFacts";
import { templateName } from "../../../lib/names";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { useNamed } from "../../useNamed";
import { Icon } from "../../parts";
import { PropertyRow, Section } from "../parts";
import { PickedRow } from "./PickedRow";
import { ANOMALY_PICKER } from "./AnomalyPicker";
import { PlanetPicker } from "./PlanetPicker";
import type { PlanetSectionProps } from "./planetSection";

/** Who has found `anomaly`: "found by …", "not found yet", or `null` where its source keeps no finders. */
function useFinders(anomaly: HeldAnomaly): string | null {
  const countries = useGalaxyStore((s) => s.countries);
  if (anomaly.foundBy === null) return null;
  const finders = anomaly.foundBy.map((id) => {
    const country = countries.get(id);
    return country === undefined ? `country #${id}` : templateName(country);
  });
  return finders.length === 0 ? "not found yet" : `found by ${finders.join(", ")}`;
}

/** The anomaly waiting on the planet, by the name the game gives its category, and who found it. */
export function AnomalyRow({ anomaly }: { anomaly: HeldAnomaly }) {
  const named = useNamed([anomaly.category]);
  const found = useFinders(anomaly);
  return (
    <PropertyRow label="Anomaly">
      {named(anomaly.category)}
      {found !== null && (
        <span className="muted">
          {" · "}
          {found}
        </span>
      )}
    </PropertyRow>
  );
}

/**
 * The anomaly as the Anomaly section lists it: its name, who found it, the game's description of
 * its category, and its remove button.
 */
function AnomalyRowView({ anomaly, target }: { anomaly: HeldAnomaly; target: PickerTarget }) {
  const named = useNamed([anomaly.category]);
  const found = useFinders(anomaly);
  const name = named(anomaly.category);
  const description = usePlanetDataStore(
    (s) => s.anomalies.get(anomaly.category)?.description ?? null,
  );
  return (
    <PickedRow
      art={<Icon keys={[]} glyph="?" />}
      name={name}
      lines={[
        ...(found === null ? [] : [{ className: "l2" as const, text: found }]),
        ...(description === null
          ? []
          : [{ className: "pl-anomaly-desc" as const, text: description }]),
      ]}
      remove={{
        title: "Remove this anomaly",
        label: `Remove ${name}`,
        run: () => void target.edits.removeAnomaly(),
      }}
    />
  );
}

/** An anomaly a scenario body's initializer places, by its category's name, with no remove button. */
function PlacedAnomalyRow({ category, noun }: { category: string; noun: string }) {
  const named = useNamed([category]);
  const description = usePlanetDataStore((s) => s.anomalies.get(category)?.description ?? null);
  return (
    <PickedRow
      art={<Icon keys={[]} glyph="?" />}
      name={named(category)}
      lines={[
        { className: "l2", text: placedAnomaly(noun) },
        ...(description === null
          ? []
          : [{ className: "pl-anomaly-desc" as const, text: description }]),
      ]}
      remove={null}
    />
  );
}

/** What a scenario body's initializer says of its anomalies: the ones it places, or whether one can appear. */
function StatedAnomalySection({ anomalies, noun }: { anomalies: StatedAnomalies; noun: string }) {
  const line = anomalyLine(anomalies, noun);
  return (
    <Section id="planet.anomaly" title="Anomaly">
      {anomalies.categories.map((category, i) => (
        <PlacedAnomalyRow key={`${category}-${i}`} category={category} noun={noun} />
      ))}
      {line !== null && <div className="muted ins-hint">{line}</div>}
    </Section>
  );
}

/**
 * The body's anomaly, with its remove button, or the picker that adds one; where the page offers
 * anomalies. A scenario body shows what its initializer says instead.
 */
export function PlanetAnomaly({ read, offers }: PlanetSectionProps) {
  const spawn = read.summary.spawn;
  if (spawn !== undefined && !offers.anomaly) {
    return <StatedAnomalySection anomalies={spawn.anomalies} noun={bodyNoun(read.summary)} />;
  }
  if (!offers.anomaly) return null;
  const { anomaly } = read.rows;
  return (
    <Section id="planet.anomaly" title="Anomaly">
      {anomaly === null ? (
        <PlanetPicker kind={ANOMALY_PICKER} target={read.target} />
      ) : (
        <AnomalyRowView anomaly={anomaly} target={read.target} />
      )}
    </Section>
  );
}
