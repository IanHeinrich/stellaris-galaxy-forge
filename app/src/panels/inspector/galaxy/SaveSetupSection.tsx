import type { GalaxySettings } from "../../../generated/GalaxySettings";
import { Properties, PropertyRow, Section } from "../parts";
import { settingRows } from "./saveSetup";

/** The settings a save was started with that the game keeps reading, read-only. */
export function SaveSetupSection({ settings }: { settings: GalaxySettings }) {
  const rows = settingRows(settings);
  if (rows.length === 0) return null;
  return (
    <Section id="galaxy.settings" title="Game setup">
      <Properties>
        {rows.map(([label, value]) => (
          <PropertyRow key={label} label={label}>
            {value}
          </PropertyRow>
        ))}
      </Properties>
    </Section>
  );
}
