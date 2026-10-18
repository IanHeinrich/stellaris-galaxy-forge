import { useMemo } from "react";
import type { StarType } from "../generated/StarType";
import { starTypeName } from "../lib/multiStar";
import { useGameDataStore } from "../store/gameDataStore";
import { IconPicker, type IconPickerItem } from "./IconPicker";
import { StarArt } from "./StarDiagram";
import { useStarClassItems } from "./useStarClassItems";

/** The map icon picker's choice while the automatic class is still being asked for. */
const PENDING: IconPickerItem = { key: "__pending__", label: "…" };
const SLOT_ART_PX = 18;

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
  const items = useMemo(
    (): IconPickerItem[] =>
      (starTypes ?? []).map((t) => ({
        key: t.key,
        label: t.name,
        group: t.usual ? "Usual stars" : "Other stars",
        icon: <StarArt star={t.key} size={SLOT_ART_PX} />,
      })),
    [starTypes],
  );
  const current = {
    key: star,
    label: starTypeName(starTypes, star),
    icon: <StarArt star={star} size={SLOT_ART_PX} />,
  };
  return (
    <IconPicker
      label={label}
      title={disabledReason ?? current.label}
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
  const tagged = rows.map((item): IconPickerItem => {
    const modifiers = starClasses.get(item.key)?.modifiers ?? [];
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
      title={title ?? current.label}
      disabled={disabled}
      current={current}
      items={tagged}
      triggerClassName={triggerClassName}
      floating={floating}
      onPick={(key) => onPick(key === automatic ? null : key)}
    />
  );
}
