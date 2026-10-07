import { useId, useState } from "react";
import type { CardItem } from "./PickerCard";
import type { ModifierRow } from "../../../lib/details/planetPage";
import { Icon } from "../../parts";
import { Section } from "../parts";
import { MODIFIER_PICKER } from "./ModifierPicker";
import { PickedRow } from "./PickedRow";
import type { Spread } from "./PlanetDeposits";
import { modifierCard } from "./modifierCard";
import { EffectSummary, PickerCard } from "./PickerCard";
import { PlanetPicker } from "./PlanetPicker";
import type { PlanetSectionProps } from "./planetSection";

/** A row's card while `shown`; nothing else. */
function RowCard({
  shown,
  id,
  item,
  rowId,
}: {
  shown: boolean;
  id: string;
  item: CardItem;
  rowId: string;
}) {
  return shown ? <PickerCard id={id} item={item} rowId={rowId} /> : null;
}

/**
 * A modifier's row: its first two effects and how long it lasts, its card while the pointer or
 * the focus is on it, and where editable its remove button. A row without the button takes the
 * focus itself, and whichever has the focus names the card as its description. With `spread`,
 * the row stands for several planets and says who has it.
 */
export function ModifierRowView({
  row,
  onRemove,
  spread,
}: {
  row: ModifierRow;
  onRemove: (() => void) | null;
  spread?: Spread;
}) {
  const view = row.view;
  const card = modifierCard(row);
  const name = card.label;
  const id = useId();
  const [shown, setShown] = useState(false);
  const show = () => setShown(true);
  const hide = () => setShown(false);
  const cardId = `${id}-card`;
  const describedBy = shown ? cardId : undefined;
  const focusable = onRemove === null;
  const line =
    card.effects.length === 0 ? (
      card.note
    ) : (
      <>
        <EffectSummary effects={card.effects} />
        {card.note !== undefined && ` · ${card.note}`}
      </>
    );
  return (
    <div
      id={id}
      role={focusable ? "group" : undefined}
      aria-label={focusable ? name : undefined}
      tabIndex={focusable ? 0 : undefined}
      aria-describedby={focusable ? describedBy : undefined}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <PickedRow
        art={
          <>
            <Icon keys={view?.icon == null ? [] : [view.icon]} glyph="◆" />
            {view?.icon_frame != null && <Icon className="pl-mod-frame" keys={[view.icon_frame]} />}
          </>
        }
        name={name}
        mono={view === undefined}
        lines={[
          ...(line === undefined ? [] : [{ className: "l2" as const, text: line }]),
          ...(spread === undefined
            ? []
            : [
                { className: "l3" as const, text: spread.line },
                {
                  className: "l3" as const,
                  text: <span className="pl-spread-acts">{spread.actions}</span>,
                },
              ]),
        ]}
        remove={
          onRemove === null
            ? null
            : {
                title: row.feature ? "Remove this planet feature" : "Remove this modifier",
                label: `Remove ${name}`,
                run: onRemove,
                describedBy,
              }
        }
      />
      <RowCard shown={shown} id={cardId} item={card} rowId={id} />
    </div>
  );
}

/**
 * The planet's modifiers; where the page offers them, each with its remove button and the picker
 * below, both through the target's adapter.
 */
export function PlanetModifiers({ read, offers }: PlanetSectionProps) {
  const editable = offers.modifiers;
  const { modifiers } = read.rows;
  const { target } = read;
  if (modifiers.length === 0 && !editable) return null;
  return (
    <Section id="planet.modifiers" title="Modifiers" count={modifiers.length}>
      {modifiers.map(({ row, ref }) => (
        <ModifierRowView
          key={row.key}
          row={row}
          onRemove={editable ? () => void target.edits.removeModifier(ref) : null}
        />
      ))}
      {editable && <PlanetPicker kind={MODIFIER_PICKER} target={target} />}
    </Section>
  );
}
