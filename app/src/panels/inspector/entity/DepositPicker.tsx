import { useEffect, useMemo } from "react";
import {
  amountText,
  blockerChips,
  DEPOSIT_CHIPS,
  depositRows,
  depositSections,
  type DepositRow,
  type PickerMode,
} from "../../../lib/details/depositPicker";
import type { PickerTarget } from "../../../lib/details/picker";
import { resourceAbbrev } from "../../../lib/details/resources";
import { useDepositPickerStore } from "../../../store/depositPickerStore";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { Icon } from "../../parts";
import { PickerMenu, PickerOpener, type PickerItem } from "./PickerMenu";

export const PICKER_NEEDS_GAME_DATA = "Adding a deposit needs the game data";
export const READING_CHOICES = "Reading the deposit types…";
export const NONE_MATCH = "No deposit type matches";

/** What the game will take away for adding the deposit type `key`, for the user to confirm. */
export type DepositWarnings = (key: string) => readonly string[];

/** What each picker's button says, and its hover text. */
const OPENERS: Record<PickerMode, { label: string; title: string }> = {
  deposits: {
    label: "+ Add deposit…",
    title: "Add deposits of any type. The ones the game places on this planet come first.",
  },
  blockers: {
    label: "+ Add blocker…",
    title: "Add blockers of any type. The ones the game places on this planet come first.",
  },
};

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

/** What the game will take away for the add waiting on it, and the buttons that make or drop it. */
function PendingConfirm({ warnings }: { warnings: readonly string[] }) {
  const store = useDepositPickerStore.getState();
  return (
    <div className="dp-confirm" role="alert">
      {warnings.map((warning) => (
        <span key={warning}>{warning}</span>
      ))}
      <span className="pl-dep-confirm-actions">
        <button type="button" className="dp-amount" onClick={() => void store.confirm()}>
          Add anyway
        </button>
        <button type="button" className="dp-amount" onClick={() => store.cancel()}>
          Cancel
        </button>
      </span>
    </div>
  );
}

/**
 * The open picker, with the chips: categories for deposits, clearing techs for blockers. One row
 * per deposit family has a button per amount, and Left and Right step between them.
 */
function DepositMenu({
  target,
  mode,
  warnings,
}: {
  target: PickerTarget;
  mode: PickerMode;
  warnings?: DepositWarnings;
}) {
  const query = useDepositPickerStore((s) => s.query);
  const chip = useDepositPickerStore((s) => s.chip);
  const pending = useDepositPickerStore((s) => s.pending);
  const choices = useDepositPickerStore((s) => s.choices);
  const views = usePlanetDataStore((s) => s.depositTypes);
  useEffect(() => useDepositPickerStore.getState().open(target, mode), [target, mode]);

  const rows = useMemo(
    () => (choices === null ? null : depositRows(choices.list, views, mode)),
    [choices, views, mode],
  );
  const blockers = mode === "blockers";
  const add = (row: DepositRow, amount: number) => {
    const picked = row.amounts[amount];
    if (picked !== undefined)
      void useDepositPickerStore.getState().add(row, picked, warnings?.(picked.key));
  };
  return (
    <PickerMenu
      usePicker={useDepositPickerStore}
      name={blockers ? "Add blockers" : "Add deposits"}
      searchName={blockers ? "Search blockers" : "Search deposits"}
      placeholder={blockers ? "Search name or effect" : "Search name, resource or category"}
      chips={blockers ? blockerChips(rows ?? []) : DEPOSIT_CHIPS}
      chipsName={blockers ? "Blocker filters" : "Deposit categories"}
      sections={rows === null ? null : depositSections(rows, chip, query)}
      reading={READING_CHOICES}
      noneMatch={NONE_MATCH}
      idPrefix={`dp-row-${target.key}-${mode}`}
      item={depositItem}
      onAdd={add}
      variants
      notice={pending === null ? undefined : <PendingConfirm warnings={pending.warnings} />}
    />
  );
}

/**
 * A picker's button, and the picker below it while open: `deposits` adds any deposit but a
 * blocker, `blockers` adds a blocker. `warnings`, where given, are confirmed before an add.
 */
export function DepositPicker({
  target,
  mode,
  warnings,
}: {
  target: PickerTarget;
  mode: PickerMode;
  warnings?: DepositWarnings;
}) {
  const open = useDepositPickerStore((s) => s.target?.key === target.key && s.mode === mode);
  if (open) return <DepositMenu target={target} mode={mode} warnings={warnings} />;
  const opener = OPENERS[mode];
  return (
    <PickerOpener
      label={opener.label}
      title={opener.title}
      needsGameData={PICKER_NEEDS_GAME_DATA}
      onOpen={() => useDepositPickerStore.getState().open(target, mode)}
    />
  );
}
