import { daysLeft, modifierRows, type ModifierRow } from "../../../lib/details/planetPage";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { Icon } from "../../parts";
import { Section } from "../parts";
import { MODIFIER_PICKER } from "./ModifierPicker";
import { PickedRow } from "./PickedRow";
import { PlanetPicker } from "./PlanetPicker";
import type { PlanetSectionProps } from "./planetSection";

function ModifierRowView({ row, onRemove }: { row: ModifierRow; onRemove: (() => void) | null }) {
  const view = row.view;
  const name = view?.name ?? row.key;
  const line = [
    ...(view?.effects.map((e) => e.text) ?? []),
    ...(row.days === null ? [] : [daysLeft(row.days)]),
  ].join(" · ");
  return (
    <PickedRow
      art={
        <>
          <Icon keys={view?.icon == null ? [] : [view.icon]} glyph="◆" />
          {view?.icon_frame != null && <Icon className="pl-mod-frame" keys={[view.icon_frame]} />}
        </>
      }
      name={name}
      mono={view === undefined}
      lines={line === "" ? [] : [{ className: "l2", text: line }]}
      remove={
        onRemove === null
          ? null
          : {
              title: row.feature ? "Remove this planet feature" : "Remove this modifier",
              label: `Remove ${name}`,
              run: onRemove,
            }
      }
    />
  );
}

/**
 * The planet's modifiers; where the page offers them, each with its remove button and the picker
 * below, both through `target`'s adapter.
 */
export function PlanetModifiers({ page, offers, target }: PlanetSectionProps) {
  const views = usePlanetDataStore((s) => s.modifiers);
  const editable = offers.modifiers;
  const rows = modifierRows(page, views);
  if (rows.length === 0 && !editable) return null;
  return (
    <Section id="planet.modifiers" title="Modifiers" count={rows.length}>
      {rows.map((row) => (
        <ModifierRowView
          key={row.key}
          row={row}
          onRemove={editable ? () => void target.edits.removeModifier(row) : null}
        />
      ))}
      {editable && <PlanetPicker kind={MODIFIER_PICKER} target={target} />}
    </Section>
  );
}
