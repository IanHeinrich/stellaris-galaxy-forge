import type { ModifierRow } from "../../../lib/details/planetPage";
import {
  bodyNoun,
  featuresTail,
  featuresWithClass,
  mergedByName,
  modifierLine,
} from "../../../lib/details/spawnFacts";
import { useGameDataStore } from "../../../store/gameDataStore";
import { Section } from "../parts";
import { ModifierArt } from "./ModifierArt";
import { MODIFIER_PICKER } from "./ModifierPicker";
import { PickedRow } from "./PickedRow";
import type { Spread } from "./RowParts";
import { modifierCard } from "./modifierCard";
import { EffectSummary, HoverCard } from "../HoverCard";
import { useHoverCard } from "../useHoverCard";
import { PlanetPicker } from "./PlanetPicker";
import type { PlanetSectionProps } from "./planetSection";
import { FeaturePool, PoolLines } from "./Pools";
import { useFeatureNamer } from "./useFeatureNamer";

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
  const { id, cardId, shown, describedBy, hover, focus } = useHoverCard();
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
      {...hover}
      {...focus}
    >
      <PickedRow
        art={<ModifierArt icon={view?.icon} frame={view?.icon_frame} />}
        name={name}
        mono={view === undefined}
        lines={line === undefined ? [] : [{ className: "l2", text: line }]}
        spread={spread}
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
      {shown && <HoverCard id={cardId} item={card} rowId={id} />}
    </div>
  );
}

/**
 * The planet's modifiers; where the page offers them, each with its remove button and the picker
 * below, both through the target's adapter. A scenario body's initializer adds whether it stops
 * or clears the planet features the game rolls.
 */
export function PlanetModifiers({ read, offers }: PlanetSectionProps) {
  const editable = offers.modifiers;
  const { modifiers } = read.rows;
  const { target } = read;
  const spawn = read.summary.spawn;
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const noun = bodyNoun(read.summary, planetClasses);
  const line = spawn === undefined ? null : modifierLine(spawn.features, noun, modifiers.length);
  const named = useFeatureNamer();
  const pool = spawn?.rolled_features;
  const picked = read.pickedClass !== undefined;
  const folded = spawn !== undefined && featuresWithClass(spawn, modifiers.length, picked);
  const rolls = pool !== undefined && pool.state !== "fixed" && !folded;
  if (modifiers.length === 0 && !editable && line === null && !rolls) return null;
  return (
    <Section id="planet.modifiers" title="Modifiers" count={modifiers.length}>
      {line !== null && <div className="muted ins-hint">{line}</div>}
      {modifiers.map(({ row, ref }) => (
        <ModifierRowView
          key={row.key}
          row={row}
          onRemove={editable ? () => void target.edits.removeModifier(ref) : null}
        />
      ))}
      <PoolLines
        pool={pool}
        stated={modifiers.length}
        noun={noun}
        tail={(picks) => featuresTail(mergedByName(picks, named).length)}
        body={(picks) => <FeaturePool picks={picks} picked={picked} />}
      />
      {editable && <PlanetPicker kind={MODIFIER_PICKER} target={target} />}
    </Section>
  );
}
