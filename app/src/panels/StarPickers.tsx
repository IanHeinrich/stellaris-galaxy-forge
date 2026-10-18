import { useMemo } from "react";
import type { StarClassView } from "../generated/StarClassView";
import type { StarType } from "../generated/StarType";
import { eachStarKeys } from "../lib/details/starBody";
import { shortStarNames, starTypeName } from "../lib/multiStar";
import { useGameDataStore } from "../store/gameDataStore";
import { useGeneratorStore } from "../store/generatorStore";
import { IconPicker, type IconPickerItem } from "./IconPicker";
import { StarArt } from "./StarDiagram";
import { useStarClassItems } from "./useStarClassItems";

/** The map icon picker's choice while the automatic class is still being asked for. */
const PENDING: IconPickerItem = { key: "__pending__", label: "…" };
const SLOT_ART_PX = 18;

/** A star's row: its short name, its full name kept as the row's hover, and its art. */
function starRow(key: string, name: string, short: (key: string) => string): IconPickerItem {
  return {
    key,
    label: short(key),
    fullLabel: name,
    icon: <StarArt star={key} size={SLOT_ART_PX} />,
  };
}

/** One star slot: every star type, the usual ones first, each with its art. Repeats are allowed. */
export function StarSlot({
  label,
  star,
  starTypes,
  triggerClassName,
  floating,
  disabledReason,
  onPick,
}: {
  label: string;
  star: string;
  starTypes: readonly StarType[] | null;
  triggerClassName?: string;
  /** Floats the list over everything, as a picker in a dialog needs. */
  floating?: boolean;
  /** Why the slot cannot change now, shown as its title; unset, it can. */
  disabledReason?: string;
  onPick: (star: string) => void;
}) {
  const short = useMemo(() => shortStarNames(starTypes ?? [], true), [starTypes]);
  const items = useMemo(
    (): IconPickerItem[] =>
      (starTypes ?? []).map((t) => ({
        ...starRow(t.key, t.name, short),
        group: t.usual ? "Usual stars" : "Other stars",
      })),
    [starTypes, short],
  );
  const current = starRow(star, starTypeName(starTypes, star), short);
  return (
    <IconPicker
      label={label}
      title={disabledReason ?? current.fullLabel}
      disabled={disabledReason !== undefined}
      current={current}
      items={items}
      triggerClassName={triggerClassName}
      floating={floating}
      onPick={onPick}
    />
  );
}

/**
 * `row` named by the short names of its stars, less the leading word they share, such as "A Star +
 * F Star": the full name kept as `fullLabel`. A class that lists several stars it may have, or a
 * star the install does not name, keeps its name.
 */
function shortened(
  row: IconPickerItem,
  view: StarClassView | undefined,
  starTypes: readonly StarType[] | null,
  short: (key: string) => string,
): IconPickerItem {
  const stars = eachStarKeys(view);
  const own = view !== undefined && view.alternatives !== true ? view.planet_keys : [];
  const named = stars.length > 0 ? stars : own.length === 1 ? own : [];
  const known = new Set(starTypes?.map((t) => t.key));
  if (named.length === 0 || !named.every((key) => known.has(key))) return row;
  return { ...row, label: named.map(short).join(" + "), fullLabel: row.label };
}

/**
 * The class a system is filed under, which sets its galaxy map icon: every class, multiple stars
 * named by their stars, a class with effects tagged with its modifiers' names in the open list
 * only. The class the
 * player chose is selected, else the class `automatic` its stars are filed under, so the choice
 * follows the stars until one is chosen. Picks null for the automatic class, else the class.
 */
export function MapIconPicker({
  label,
  automatic,
  chosen,
  title,
  disabled,
  triggerClassName,
  floating,
  onPick,
}: {
  label: string;
  /** The automatic class, or undefined while it is being asked for. */
  automatic: string | undefined;
  /** The class the player chose, or null for the automatic one. */
  chosen: string | null;
  title?: string;
  disabled?: boolean;
  triggerClassName?: string;
  /** Floats the list over everything, as a picker in a dialog needs. */
  floating?: boolean;
  onPick: (starClass: string | null) => void;
}) {
  const starClasses = useGameDataStore((s) => s.starClasses);
  const choices = useMemo(
    () => [...starClasses.values()].filter((v) => v.fileable === true),
    [starClasses],
  );
  const rows = useStarClassItems(choices);
  const starTypes = useGeneratorStore((s) => s.starTypes);
  const short = useMemo(() => shortStarNames(starTypes ?? [], true), [starTypes]);
  const tagged = rows.map((row): IconPickerItem => {
    const view = starClasses.get(row.key);
    const item = shortened(row, view, starTypes, short);
    const modifiers = view?.modifiers ?? [];
    if (modifiers.length === 0) return item;
    return {
      ...item,
      note: modifiers.map((m) => (
        <span key={m.key} className="star-mod-tag">
          {m.name}
        </span>
      )),
    };
  });
  const shown = chosen ?? automatic;
  const chosenRow = tagged.find((i) => i.key === shown);
  const current = chosenRow === undefined ? PENDING : { ...chosenRow, note: undefined };
  return (
    <IconPicker
      label={label}
      title={title ?? current.fullLabel ?? current.label}
      disabled={disabled}
      current={current}
      items={tagged}
      triggerClassName={triggerClassName}
      floating={floating}
      onPick={(key) => onPick(key === automatic ? null : key)}
    />
  );
}
