/**
 * The deposit picker on a planet's page: one row per deposit family, the chips that narrow the
 * rows to a category, and the search that narrows them further.
 */
import type { DepositCategory } from "../../generated/DepositCategory";
import type { DepositChoice } from "../../generated/DepositChoice";
import type { DepositTypeView } from "../../generated/DepositTypeView";
import { formatAmount } from "./resources";
import { effectText } from "./planetEdits";

/** What a picker adds: any deposit but a blocker, or a blocker. */
export type PickerMode = "deposits" | "blockers";

/** A chip above the rows: every row, the rows the roll could place here, or one category. */
export type DepositChip = "All" | "Usual" | DepositCategory;

/**
 * The chips the deposit picker shows, in order, each with its label. The blocker picker shows
 * none: its rows are all one category, and the usual ones already lead the list.
 */
export const DEPOSIT_CHIPS: readonly { chip: DepositChip; label: string }[] = [
  { chip: "All", label: "All" },
  { chip: "Usual", label: "Usual here" },
  { chip: "Energy", label: "Energy" },
  { chip: "Minerals", label: "Minerals" },
  { chip: "Food", label: "Food" },
  { chip: "Research", label: "Research" },
  { chip: "Strategic", label: "Strategic" },
  { chip: "Features", label: "Features" },
  { chip: "Special", label: "Special" },
];

/** One deposit type a row adds: its key, and the amount its button shows in a family. */
export interface DepositAmount {
  key: string;
  amount: number | null;
}

/** One row: a family of types that differ only in amount, or one type of its own. */
export interface DepositRow {
  family: string;
  /** The type the row's art, name and effects are read from: its first. */
  view: DepositTypeView | undefined;
  label: string;
  /**
   * What it gives, spelled out: "Energy per month", or "+2 Minerals, Blocks 1 district"; empty
   * for a type that gives nothing.
   */
  gives: string;
  /** Its first type's localised description, for the row's hover text. */
  description: string | null;
  /** Its first type's category that is not Special, else Special. */
  category: DepositCategory;
  /** The roll could place one of its types here. */
  usual: boolean;
  /** Its types, smallest amount first. */
  amounts: DepositAmount[];
  /** What the search matches, lower case: name, resources, effects and category. */
  search: string;
}

/** A heading and the rows under it; the heading is empty for a single list. */
export interface DepositSection {
  title: string;
  rows: DepositRow[];
}

function signed(n: number): string {
  return n > 0 ? `+${formatAmount(n)}` : formatAmount(n);
}

/**
 * What a type is called: the resources an orbital deposit yields, whose own name is only its
 * amount ("+10"), or else its localised name, or its key without a view.
 */
function typeLabel(key: string, view: DepositTypeView | undefined): string {
  if (view === undefined) return key;
  if (view.yields.length > 0) return view.yields.map((y) => y.name).join(" and ");
  return view.name || key;
}

/** What one type gives: each yield with its amount, then each effect. */
function typeGives(view: DepositTypeView | undefined): string {
  if (view === undefined) return "";
  return [
    ...view.yields.map((y) => `${signed(y.amount)} ${y.name}`),
    ...view.effects.map(effectText),
  ].join(", ");
}

/** What a family gives, whatever the amount picked: its resources per month. */
function familyGives(view: DepositTypeView | undefined): string {
  if (view === undefined || view.yields.length === 0) return typeGives(view);
  return `${view.yields.map((y) => y.name).join(" and ")} per month`;
}

/** The offered types `mode` adds as rows, one per family, by name; a family's types by amount. */
export function depositRows(
  choices: readonly DepositChoice[],
  views: ReadonlyMap<string, DepositTypeView>,
  mode: PickerMode,
): DepositRow[] {
  const families = new Map<string, DepositChoice[]>();
  const wanted = choices.filter((c) => (c.category === "Blockers") === (mode === "blockers"));
  for (const choice of wanted) {
    const members = families.get(choice.family);
    if (members === undefined) families.set(choice.family, [choice]);
    else members.push(choice);
  }
  const rows = [...families.entries()].map(([family, members]): DepositRow => {
    const sorted = [...members].sort((a, b) => (a.amount ?? 0) - (b.amount ?? 0));
    const first = sorted[0];
    const view = views.get(first.key);
    const label = typeLabel(first.key, view);
    const gives = sorted.length > 1 ? familyGives(view) : typeGives(view);
    const category = sorted.find((m) => m.category !== "Special")?.category ?? "Special";
    return {
      family,
      view,
      label,
      gives,
      description: first.description,
      category,
      usual: sorted.some((m) => m.usual),
      amounts: sorted.map((m) => ({ key: m.key, amount: sorted.length > 1 ? m.amount : null })),
      search: [label, gives, category].join(" ").toLowerCase(),
    };
  });
  return rows.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The rows `chip` and `query` leave, as the list shows them: under All, those the roll could place
 * here first, then everything else; under any other chip, one list.
 */
export function depositSections(
  rows: readonly DepositRow[],
  chip: DepositChip,
  query: string,
): DepositSection[] {
  const words = query.trim().toLowerCase();
  const matching = rows.filter((row) => words === "" || row.search.includes(words));
  if (chip === "All") {
    return [
      { title: "Usual for this planet", rows: matching.filter((row) => row.usual) },
      { title: "Everything else", rows: matching.filter((row) => !row.usual) },
    ].filter((section) => section.rows.length > 0);
  }
  const kept = matching.filter((row) => (chip === "Usual" ? row.usual : row.category === chip));
  return kept.length === 0 ? [] : [{ title: "", rows: kept }];
}

/** The line that confirms an add: "Added +3 Energy", or "Added Rich Mountains". */
export function addedLine(row: DepositRow, amount: DepositAmount): string {
  return amount.amount === null
    ? `Added ${row.label}`
    : `Added ${signed(amount.amount)} ${row.label}`;
}

/** An amount button's text. */
export function amountText(amount: DepositAmount): string {
  return amount.amount === null ? "Add" : signed(amount.amount);
}
