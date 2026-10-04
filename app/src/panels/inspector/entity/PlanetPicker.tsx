import { useEffect, type ReactNode } from "react";
import type { ChipItem, PickerSection, PickerTarget } from "../../../lib/details/picker";
import { PickerMenu, PickerOpener, type PickerHook, type PickerItem } from "./PickerMenu";

/** What a picker says: the menu's words, for a screen reader and the screen, and the opener's. */
export interface PickerWords {
  name: string;
  searchName: string;
  placeholder: string;
  chipsName: string;
  /** Shown while the choices are read. */
  reading: string;
  noneMatch: string;
  opener: { label: string; title: string; needsGameData: string };
}

/**
 * One kind of picker on a planet's page: its store, its words, and how it lists its choices and
 * adds one. `X` is what the page hands the add, such as the warnings to confirm first.
 */
export interface PickerKind<R, C extends string, T, X = undefined> {
  store: PickerHook<C, T>;
  words: PickerWords;
  /** The chips, or a function of the rows where they follow them. */
  chips: readonly ChipItem<C>[] | ((rows: readonly R[]) => readonly ChipItem<C>[]);
  /** Left and Right step between a row's buttons, and typing goes to the search. */
  variants?: boolean;
  /** Starts each row's element id. */
  idPrefix(target: PickerTarget): string;
  /** Whether the kind's picker is open on `target`'s body. */
  useIsOpen(target: PickerTarget): boolean;
  open(target: PickerTarget): void;
  /** The rows for the choices read, `null` until they are. */
  useRows(choices: { list: T[] } | null, target: PickerTarget): R[] | null;
  /** The rows `chip` and `query` leave, under their headings. */
  sections(rows: readonly R[], chip: C, query: string): PickerSection<R>[];
  item(row: R): PickerItem;
  onAdd(row: R, button: number, extra?: X): void;
  /** Drawn under the chips. */
  useControls?(target: PickerTarget): ReactNode;
  /** Drawn in place of the line saying what was added. */
  useNotice?(): ReactNode;
}

const NO_CONTROLS = (): ReactNode => null;
const NO_NOTICE = (): ReactNode => undefined;

function PickerOpen<R, C extends string, T, X>({
  kind,
  target,
  extra,
}: {
  kind: PickerKind<R, C, T, X>;
  target: PickerTarget;
  extra?: X;
}) {
  const query = kind.store((s) => s.query);
  const chip = kind.store((s) => s.chip);
  const choices = kind.store((s) => s.choices);
  const useControls = kind.useControls ?? NO_CONTROLS;
  const useNotice = kind.useNotice ?? NO_NOTICE;
  const controls = useControls(target);
  const notice = useNotice();
  useEffect(() => {
    kind.open(target);
  }, [kind, target]);
  const rows = kind.useRows(choices, target);
  return (
    <PickerMenu
      kind={kind}
      extra={extra}
      chips={typeof kind.chips === "function" ? kind.chips(rows ?? []) : kind.chips}
      sections={rows === null ? null : kind.sections(rows, chip, query)}
      idPrefix={kind.idPrefix(target)}
      controls={controls}
      notice={notice}
    />
  );
}

/** A picker's button, and its menu below it while open on `target`'s body. */
export function PlanetPicker<R, C extends string, T, X = undefined>({
  kind,
  target,
  extra,
}: {
  kind: PickerKind<R, C, T, X>;
  target: PickerTarget;
  extra?: X;
}) {
  const open = kind.useIsOpen(target);
  if (open) return <PickerOpen kind={kind} target={target} extra={extra} />;
  const { opener } = kind.words;
  return (
    <PickerOpener
      label={opener.label}
      title={opener.title}
      needsGameData={opener.needsGameData}
      onOpen={() => kind.open(target)}
    />
  );
}
