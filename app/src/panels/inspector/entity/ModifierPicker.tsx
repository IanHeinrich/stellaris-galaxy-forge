import { useEffect, useMemo, useState } from "react";
import {
  MODIFIER_CHIPS,
  modifierPickRows,
  modifierSections,
  parseDays,
  type ModifierPickRow,
} from "../../../lib/details/modifierPicker";
import type { PickerTarget } from "../../../lib/details/picker";
import { terraformCandidateTitle } from "../../../lib/details/terraform";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useModifierPickerStore } from "../../../store/modifierPickerStore";
import { Icon } from "../../parts";
import { PickerMenu, PickerOpener, type PickerItem } from "./PickerMenu";

export const MODIFIER_PICKER_NEEDS_GAME_DATA = "Adding a modifier needs the game data";
export const READING_MODIFIERS = "Reading the modifiers…";
export const NO_MODIFIER_MATCHES = "No modifier matches";
const DEFAULT_DAYS = 360;

/** A modifier's row: its icon in its frame, and one Add button, spent once the body has it. */
function modifierItem(row: ModifierPickRow): PickerItem {
  const view = row.choice.view;
  return {
    key: row.key,
    label: row.label,
    gives: row.gives,
    description: row.description,
    artClass: "pl-mod-icon",
    art: (
      <>
        <Icon keys={view.icon === null ? [] : [view.icon]} glyph="◆" />
        {view.icon_frame !== null && <Icon className="pl-mod-frame" keys={[view.icon_frame]} />}
      </>
    ),
    buttons: [
      {
        text: row.held ? "Has it" : "Add",
        label: `Add ${row.label}`,
        title: row.held ? "This planet already has it" : `Add ${row.label}`,
        disabled: row.held,
      },
    ],
  };
}

/** How long the next add lasts: for ever, or a number of days. */
function Duration() {
  const days = useModifierPickerStore((s) => s.days);
  const [text, setText] = useState(String(days ?? DEFAULT_DAYS));
  const setDays = useModifierPickerStore.getState().setDays;
  return (
    <div className="mp-duration" role="group" aria-label="How long it lasts">
      <label>
        <input
          type="radio"
          name="mp-duration"
          checked={days === null}
          onChange={() => setDays(null)}
        />
        Permanent
      </label>
      <label>
        <input
          type="radio"
          name="mp-duration"
          checked={days !== null}
          onChange={() => setDays(parseDays(text) ?? DEFAULT_DAYS)}
        />
        For
      </label>
      <input
        type="number"
        min={1}
        aria-label="Days"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const parsed = parseDays(e.target.value);
          if (parsed !== null) setDays(parsed);
        }}
        onFocus={() => {
          if (days === null) setDays(parseDays(text) ?? DEFAULT_DAYS);
        }}
      />
      days
    </div>
  );
}

/**
 * The open picker, with the category chips, how long the next add lasts where the body's source
 * can time a modifier, and one row per modifier.
 */
function ModifierMenu({ target }: { target: PickerTarget }) {
  const query = useModifierPickerStore((s) => s.query);
  const chip = useModifierPickerStore((s) => s.chip);
  const choices = useModifierPickerStore((s) => s.choices);
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const candidates = useGameDataStore((s) => s.terraformCandidates);
  useEffect(() => useModifierPickerStore.getState().open(target), [target]);

  const usual =
    target.planetClass === null
      ? null
      : (planetClasses.get(target.planetClass)?.terraform_candidate ?? null);
  const rows = useMemo(
    () =>
      choices === null
        ? null
        : modifierPickRows(choices.list, target.modifiers, usual, (m) =>
            terraformCandidateTitle(m, candidates),
          ),
    [choices, target.modifiers, usual, candidates],
  );
  const add = (row: ModifierPickRow) => {
    if (!row.held) void useModifierPickerStore.getState().add(row);
  };
  return (
    <PickerMenu
      usePicker={useModifierPickerStore}
      name="Add modifiers"
      searchName="Search modifiers"
      placeholder="Search name or effect"
      chips={MODIFIER_CHIPS}
      chipsName="Modifier categories"
      sections={rows === null ? null : modifierSections(rows, chip, query)}
      reading={READING_MODIFIERS}
      noneMatch={NO_MODIFIER_MATCHES}
      idPrefix={`mp-row-${target.key}`}
      item={modifierItem}
      onAdd={add}
      controls={target.edits.timedModifiers && <Duration />}
    />
  );
}

/** The picker's button, and the picker below it while open. */
export function ModifierPicker({ target }: { target: PickerTarget }) {
  const open = useModifierPickerStore((s) => s.target?.key === target.key);
  if (open) return <ModifierMenu target={target} />;
  return (
    <PickerOpener
      label="+ Add modifier…"
      title="Add a modifier, for good or for some days. A planet feature adds as a feature."
      needsGameData={MODIFIER_PICKER_NEEDS_GAME_DATA}
      onOpen={() => useModifierPickerStore.getState().open(target)}
    />
  );
}
