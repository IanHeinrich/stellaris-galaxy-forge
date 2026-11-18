import { useMemo } from "react";
import type { EffectModifier } from "../../../../../generated/EffectModifier";
import { documentCapabilities } from "../../../../../lib/capabilities";
import { effectMark, NO_SYSTEM_MODIFIERS } from "../../../../../lib/details/placedRows";
import {
  systemModifierRow,
  systemModifierTarget,
} from "../../../../../lib/details/systemModifiers";
import { useFileSessionStore } from "../../../../../store/fileSessionStore";
import { useGalaxyStore } from "../../../../../store/galaxyStore";
import { usePlanetDataStore } from "../../../../../store/planetDataStore";
import { removeSystemModifier } from "../../../../../store/systemModifierPickerStore";
import { OriginMark } from "../../../../parts";
import { ModifierRowView } from "../../../entity/PlanetModifiers";
import { SYSTEM_MODIFIER_PICKER } from "../../../entity/ModifierPicker";
import { PlanetPicker } from "../../../entity/PlanetPicker";
import { usePlanetData } from "../../../entity/usePlanetData";
import { Empty, Section } from "../../../parts";

/**
 * The modifiers the scenario's own effect block adds to the system, each named from the game
 * data. Where the document edits them, each the editor wrote can be taken out, the rest are marked
 * as the file's, and the picker below adds one.
 */
export function SystemModifierSection({
  system,
  modifiers,
}: {
  system: number;
  modifiers: readonly EffectModifier[];
}) {
  const editable = useFileSessionStore((s) => documentCapabilities(s).system_modifiers);
  const name = useGalaxyStore((s) => s.systemName(system));
  const views = usePlanetDataStore((s) => s.modifiers);
  const keys = useMemo(
    () => ({
      deposits: [],
      modifiers: modifiers.map((m) => m.modifier),
      colonyTypes: [],
      anomalies: [],
      digSites: [],
    }),
    [modifiers],
  );
  usePlanetData(keys);
  const target = useMemo(
    () => systemModifierTarget(system, name, modifiers),
    [system, name, modifiers],
  );
  return (
    <Section id="system.modifiers" title="Modifiers" count={modifiers.length}>
      {modifiers.length === 0 && <Empty>{NO_SYSTEM_MODIFIERS}</Empty>}
      {modifiers.map((modifier, i) => {
        const mark = effectMark(modifier.editable, editable);
        const row = systemModifierRow(modifier, views);
        return (
          <ModifierRowView
            key={`${modifier.modifier}-${i}`}
            row={row}
            mark={mark !== null && <OriginMark mark={mark} />}
            onRemove={
              mark === null ? () => void removeSystemModifier(system, modifier.modifier) : null
            }
          />
        );
      })}
      {editable && <PlanetPicker kind={SYSTEM_MODIFIER_PICKER} target={target} />}
    </Section>
  );
}
