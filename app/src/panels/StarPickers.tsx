import { useMemo } from "react";
import type { StarType } from "../generated/StarType";
import { starTypeName } from "../lib/multiStar";
import { useGameDataStore } from "../store/gameDataStore";
import { IconPicker, type IconPickerItem } from "./IconPicker";
import { StarArt } from "./StarDiagram";
import { useStarClassItems } from "./useStarClassItems";

/** The key of the map icon picker's Automatic row: never a star class key. */
const AUTOMATIC_KEY = "__automatic__";
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
      title={disabledReason}
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
 * The class a system is filed under, which sets its galaxy map icon: Automatic first, naming the
 * class `automatic` its stars are filed under, then every class, multiple stars named by their
 * stars, a class with effects tagged with its modifiers' names. Picks null for Automatic.
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
  const autoRow = automatic === undefined ? undefined : tagged.find((i) => i.key === automatic);
  const auto: IconPickerItem = {
    key: AUTOMATIC_KEY,
    label: `${autoRow?.label ?? automatic ?? "…"} (automatic)`,
    icon: autoRow?.icon,
  };
  const items = [auto, ...tagged];
  const current = chosen === null ? auto : (tagged.find((i) => i.key === chosen) ?? auto);
  return (
    <IconPicker
      label={label}
      title={title}
      disabled={disabled}
      current={current}
      items={items}
      triggerClassName={triggerClassName}
      floating={floating}
      onPick={(key) => onPick(key === AUTOMATIC_KEY ? null : key)}
    />
  );
}
