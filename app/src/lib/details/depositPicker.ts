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

/**
 * A chip above the rows: every row, the rows the roll could place here, or one category. The
 * blocker picker's chips are the techs that clear its blockers, as `tech:<key>`, `NoTech` and
 * `Uncleared`, and `Special`.
 */
export type DepositChip =
  "All" | "Usual" | DepositCategory | "NoTech" | "Uncleared" | `tech:${string}`;

/** A chip and what it says. */
export interface ChipItem {
  chip: DepositChip;
  label: string;
}

/** The chips the deposit picker shows, in order, each with its label. */
export const DEPOSIT_CHIPS: readonly ChipItem[] = [
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
  /** Its button's hover text: what this type gives, then its own description when it has one. */
  title: string;
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
  /**
   * Its first type's localised description, for the row's hover text; `null` for a family,
   * whose types each describe themselves on their own button.
   */
  description: string | null;
  /** Its first type's category that is not Special, else Special. */
  category: DepositCategory;
  /**
   * The Special chip keeps it: a type no roll places, or a blocker that does more, or other, than
   * take away districts of every kind.
   */
  special: boolean;
  /**
   * For a blocker, the techs clearing it needs, by key and name: empty when it needs none, `null`
   * when it cannot be cleared. `null` for any other type.
   */
  clearedBy: { key: string; name: string }[] | null;
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

/**
 * `text` when it describes a type, `null` when it is empty or only an amount ("+1", "£energy£ +5"
 * reads as "+5"), as an orbital deposit's localisation is.
 */
export function describes(text: string | null): string | null {
  const trimmed = text?.trim() ?? "";
  return trimmed === "" || /^[+-]?\d+(\.\d+)?$/.test(trimmed) ? null : trimmed;
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
    const blocker = category === "Blockers";
    return {
      family,
      view,
      label,
      gives,
      description: sorted.length > 1 ? null : describes(first.description),
      category,
      special: category === "Special" || (blocker && (first.event_only || !plainBlock(view))),
      clearedBy: blocker ? (view?.clearing?.techs ?? null) : null,
      usual: sorted.some((m) => m.usual),
      amounts: sorted.map((m) => {
        const amount = sorted.length > 1 ? m.amount : null;
        const own = describes(m.description);
        const gives = amount === null ? label : `${signed(amount)} ${label}`;
        return { key: m.key, amount, title: own === null ? gives : `${gives}. ${own}` };
      }),
      search: [label, gives, category].join(" ").toLowerCase(),
    };
  });
  return rows.sort((a, b) => a.label.localeCompare(b.label));
}

/** Whether a blocker only takes away districts of every kind: "Blocks 1 district". */
function plainBlock(view: DepositTypeView | undefined): boolean {
  if (view === undefined) return true;
  const [effect, ...more] = view.effects;
  return (
    more.length === 0 &&
    view.yields.length === 0 &&
    effect?.key === "planet_max_districts_add" &&
    effect.value < 0
  );
}

/**
 * The blocker picker's chips: All, Usual here, one per tech that clears a blocker by its name, then
 * No tech needed, Can't be cleared and Special where a blocker is so.
 */
export function blockerChips(rows: readonly DepositRow[]): ChipItem[] {
  const techs = new Map<string, string>();
  for (const row of rows) for (const tech of row.clearedBy ?? []) techs.set(tech.key, tech.name);
  const byName = [...techs].sort((a, b) => a[1].localeCompare(b[1]));
  const some = (test: (row: DepositRow) => boolean) => rows.some(test);
  return [
    { chip: "All", label: "All" },
    { chip: "Usual", label: "Usual here" },
    ...byName.map(([key, name]): ChipItem => ({ chip: `tech:${key}`, label: name })),
    ...(some((r) => r.clearedBy?.length === 0)
      ? [{ chip: "NoTech" as const, label: "No tech needed" }]
      : []),
    ...(some((r) => r.clearedBy === null)
      ? [{ chip: "Uncleared" as const, label: "Can't be cleared" }]
      : []),
    ...(some((r) => r.special) ? [{ chip: "Special" as const, label: "Special" }] : []),
  ];
}

/** Whether `row` stays under `chip`. */
function kept(row: DepositRow, chip: DepositChip): boolean {
  if (chip === "Usual") return row.usual;
  if (chip === "Special") return row.special;
  if (chip === "NoTech") return row.clearedBy?.length === 0;
  if (chip === "Uncleared") return row.category === "Blockers" && row.clearedBy === null;
  if (chip.startsWith("tech:")) {
    const tech = chip.slice("tech:".length);
    return row.clearedBy?.some((t) => t.key === tech) === true;
  }
  return row.category === chip;
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
  const left = matching.filter((row) => kept(row, chip));
  return left.length === 0 ? [] : [{ title: "", rows: left }];
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
