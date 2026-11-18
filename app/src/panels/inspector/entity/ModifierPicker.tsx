import { useMemo } from "react";
import type { ModifierChoice } from "../../../generated/ModifierChoice";
import {
  MODIFIER_CHIPS,
  modifierPickRows,
  modifierSections,
  systemModifierChips,
  type ModifierChip,
  type ModifierPickRow,
} from "../../../lib/details/modifierPicker";
import { chipLabel, type PickerTarget } from "../../../lib/details/picker";
import type { SystemModifierTarget } from "../../../lib/details/systemModifiers";
import { terraformCandidateTitle } from "../../../lib/details/terraform";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useModifierPickerStore } from "../../../store/modifierPickerStore";
import { useSystemModifierPickerStore } from "../../../store/systemModifierPickerStore";
import { ModifierDuration } from "./ModifierDuration";
import type { PickerItem } from "./PickerMenu";
import { ModifierArt } from "./ModifierArt";
import type { PickerKind } from "./PlanetPicker";

/** What a row's Add button says and its hover, for one planet or for several. */
function addButtonText(row: ModifierPickRow): { text: string; title: string } {
  if (row.lacking === null) {
    return row.held
      ? { text: "Has it", title: "This planet already has it" }
      : { text: "Add", title: `Add ${row.label}` };
  }
  return row.held
    ? { text: "All have it", title: "Every selected planet already has it" }
    : { text: `Add to ${row.lacking}`, title: `Add ${row.label} to the planets without it` };
}

/** What a system's row's Add button says and its hover. */
function systemAddButtonText(row: SystemModifierPickRow): { text: string; title: string } {
  return row.held
    ? { text: "Has it", title: `${row.system} already has it` }
    : { text: "Add", title: `Add ${row.label}` };
}

/** A modifier's row: its icon in its frame, and one Add button, spent once `row` is held. */
function modifierItem(row: ModifierPickRow, button: { text: string; title: string }): PickerItem {
  const view = row.choice.view;
  return {
    key: row.key,
    label: row.label,
    effects: row.effects,
    category: chipLabel(MODIFIER_CHIPS, row.choice.category),
    description: row.description,
    artClass: "pl-mod-icon",
    art: <ModifierArt icon={view.icon} frame={view.icon_frame} />,
    buttons: [
      {
        text: button.text,
        label: `Add ${row.label}`,
        title: button.title,
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
        : modifierPickRows(
            choices.list,
            target.modifiers,
            usual,
            (m) => terraformCandidateTitle(m, candidates),
            target.spread,
          ),
    [choices, target.modifiers, target.spread, usual, candidates],
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
  item: (row) => modifierItem(row, addButtonText(row)),
  onAdd(row) {
    if (!row.held) void useModifierPickerStore.getState().add(row);
  },
  useControls: (target) => target.edits.timedModifiers && <ModifierDuration />,
};

/** A modifier a system's picker offers, with the system's name its Add button words. */
interface SystemModifierPickRow extends ModifierPickRow {
  system: string;
}

/** The rows for the choices read: none usual, each held where the system's own block adds it. */
function useSystemModifierRows(
  choices: { list: ModifierChoice[] } | null,
  target: SystemModifierTarget,
): SystemModifierPickRow[] | null {
  return useMemo(
    () =>
      choices === null
        ? null
        : modifierPickRows(choices.list, target.modifiers, null, () => "").map((row) => ({
            ...row,
            system: target.name,
          })),
    [choices, target.modifiers, target.name],
  );
}

/**
 * The modifier picker on a scenario system's page, with a chip for each category the rows fall
 * in. Every add lasts for good.
 */
export const SYSTEM_MODIFIER_PICKER: PickerKind<
  SystemModifierPickRow,
  ModifierChip,
  ModifierChoice,
  undefined,
  SystemModifierTarget
> = {
  store: useSystemModifierPickerStore,
  words: {
    name: "Add system modifiers",
    searchName: "Search modifiers",
    placeholder: "Search name or effect",
    chipsName: "Modifier categories",
    reading: "Reading the modifiers…",
    noneMatch: "No modifier matches",
    opener: {
      label: "+ Add modifier…",
      title: "Add a modifier to the system for good",
      needsGameData: "Adding a modifier needs the game data",
    },
  },
  chips: systemModifierChips,
  idPrefix: (target) => `smp-row-${target.key}`,
  useIsOpen: (target) => useSystemModifierPickerStore((s) => s.target?.key === target.key),
  open: (target) => useSystemModifierPickerStore.getState().open(target),
  useRows: useSystemModifierRows,
  sections: modifierSections,
  item: (row) => modifierItem(row, systemAddButtonText(row)),
  onAdd(row) {
    if (!row.held) void useSystemModifierPickerStore.getState().add(row);
  },
};
