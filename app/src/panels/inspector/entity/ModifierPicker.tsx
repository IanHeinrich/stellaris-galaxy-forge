import { useMemo } from "react";
import type { ModifierChoice } from "../../../generated/ModifierChoice";
import {
  MODIFIER_CHIPS,
  modifierPickRows,
  modifierSections,
  type ModifierChip,
  type ModifierPickRow,
} from "../../../lib/details/modifierPicker";
import { chipLabel, type PickerTarget } from "../../../lib/details/picker";
import { terraformCandidateTitle } from "../../../lib/details/terraform";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useModifierPickerStore } from "../../../store/modifierPickerStore";
import { Icon } from "../../parts";
import { ModifierDuration } from "./ModifierDuration";
import type { PickerItem } from "./PickerMenu";
import type { PickerKind } from "./PlanetPicker";

/** A modifier's row: its icon in its frame, and one Add button, spent once the body has it. */
function modifierItem(row: ModifierPickRow): PickerItem {
  const view = row.choice.view;
  return {
    key: row.key,
    label: row.label,
    effects: row.effects,
    category: chipLabel(MODIFIER_CHIPS, row.choice.category),
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

/** The rows for the choices read; the body's class makes its terraforming candidate the usual one. */
function useModifierRows(
  choices: { list: ModifierChoice[] } | null,
  target: PickerTarget,
): ModifierPickRow[] | null {
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const candidates = useGameDataStore((s) => s.terraformCandidates);
  const usual =
    target.planetClass === null
      ? null
      : (planetClasses.get(target.planetClass)?.terraform_candidate ?? null);
  return useMemo(
    () =>
      choices === null
        ? null
        : modifierPickRows(choices.list, target.modifiers, usual, (m) =>
            terraformCandidateTitle(m, candidates),
          ),
    [choices, target.modifiers, usual, candidates],
  );
}

/**
 * The modifier picker, with the category chips, how long the next add lasts where the body's
 * source can time a modifier, and one row per modifier.
 */
export const MODIFIER_PICKER: PickerKind<ModifierPickRow, ModifierChip, ModifierChoice> = {
  store: useModifierPickerStore,
  words: {
    name: "Add modifiers",
    searchName: "Search modifiers",
    placeholder: "Search name or effect",
    chipsName: "Modifier categories",
    reading: "Reading the modifiers…",
    noneMatch: "No modifier matches",
    opener: {
      label: "+ Add modifier…",
      title: "Add a modifier, for good or for some days. A planet feature adds as a feature.",
      needsGameData: "Adding a modifier needs the game data",
    },
  },
  chips: MODIFIER_CHIPS,
  idPrefix: (target) => `mp-row-${target.key}`,
  useIsOpen: (target) => useModifierPickerStore((s) => s.target?.key === target.key),
  open: (target) => useModifierPickerStore.getState().open(target),
  useRows: useModifierRows,
  sections: modifierSections,
  item: modifierItem,
  onAdd(row) {
    if (!row.held) void useModifierPickerStore.getState().add(row);
  },
  useControls: (target) => target.edits.timedModifiers && <ModifierDuration />,
};
