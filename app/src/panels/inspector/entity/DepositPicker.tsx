import { useMemo } from "react";
import type { DepositChoice } from "../../../generated/DepositChoice";
import {
  amountText,
  blockerChips,
  DEPOSIT_CHIPS,
  depositRows,
  depositSections,
  type DepositChip,
  type DepositRow,
  type PickerMode,
} from "../../../lib/details/depositPicker";
import { resourceAbbrev } from "../../../lib/details/resources";
import { useDepositPickerStore } from "../../../store/depositPickerStore";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { Icon } from "../../parts";
import { ConfirmLine } from "./ConfirmLine";
import type { PickerItem } from "./PickerMenu";
import type { PickerKind } from "./PlanetPicker";

/** What the game will take away for adding the deposit type `key`, for the user to confirm. */
export type DepositWarnings = (key: string) => readonly string[];

/** A deposit family's row: its art, its resources, and a button per amount. */
function depositItem(row: DepositRow): PickerItem {
  const view = row.view;
  return {
    key: row.family,
    label: row.label,
    gives: row.gives,
    description: row.description,
    art: view !== undefined && <Icon className="pl-art" keys={[view.texture_key]} glyph="" />,
    yields: view?.yields.map((y) => (
      <Icon
        key={y.resource}
        className="gi"
        keys={y.icon === null ? [] : [y.icon]}
        glyph={resourceAbbrev(y.resource)}
      />
    )),
    buttons: row.amounts.map((amount) => ({
      text: amountText(amount),
      label: `Add ${amount.amount === null ? "" : `${amountText(amount)} `}${row.label}`,
      title: amount.title,
    })),
  };
}

/** The confirm for the add waiting on what the game will take away for it; undefined when none waits. */
function usePendingConfirm() {
  const pending = useDepositPickerStore((s) => s.pending);
  if (pending === null) return undefined;
  const store = useDepositPickerStore.getState();
  return (
    <ConfirmLine
      className="dp-confirm"
      warnings={pending.warnings}
      confirmLabel="Add anyway"
      onConfirm={() => void store.confirm()}
      onCancel={() => store.cancel()}
    />
  );
}

/**
 * The deposit picker, with the chips: categories for deposits, clearing techs for blockers. One
 * row per deposit family has a button per amount, and Left and Right step between them.
 */
function depositPicker(
  mode: PickerMode,
): PickerKind<DepositRow, DepositChip, DepositChoice, DepositWarnings> {
  const blockers = mode === "blockers";
  return {
    store: useDepositPickerStore,
    words: {
      name: blockers ? "Add blockers" : "Add deposits",
      searchName: blockers ? "Search blockers" : "Search deposits",
      placeholder: blockers ? "Search name or effect" : "Search name, resource or category",
      chipsName: blockers ? "Blocker filters" : "Deposit categories",
      reading: "Reading the deposit types…",
      noneMatch: "No deposit type matches",
      opener: {
        label: blockers ? "+ Add blocker…" : "+ Add deposit…",
        title: `Add ${blockers ? "blockers" : "deposits"} of any type. The ones the game places on this planet come first.`,
        needsGameData: "Adding a deposit needs the game data",
      },
    },
    chips: blockers ? blockerChips : DEPOSIT_CHIPS,
    variants: true,
    idPrefix: (target) => `dp-row-${target.key}-${mode}`,
    useIsOpen: (target) =>
      useDepositPickerStore((s) => s.target?.key === target.key && s.mode === mode),
    open: (target) => useDepositPickerStore.getState().open(target, mode),
    useRows(choices) {
      const views = usePlanetDataStore((s) => s.depositTypes);
      return useMemo(
        () => (choices === null ? null : depositRows(choices.list, views, mode)),
        [choices, views],
      );
    },
    sections: depositSections,
    item: depositItem,
    onAdd(row, amount, warnings) {
      const picked = row.amounts[amount];
      if (picked !== undefined)
        void useDepositPickerStore.getState().add(row, picked, warnings?.(picked.key));
    },
    useNotice: usePendingConfirm,
  };
}

/** The picker for deposits of any type but a blocker, and the one for blockers. */
export const DEPOSIT_PICKERS: Record<PickerMode, ReturnType<typeof depositPicker>> = {
  deposits: depositPicker("deposits"),
  blockers: depositPicker("blockers"),
};
