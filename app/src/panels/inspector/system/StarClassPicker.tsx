import type { PlanetSummary } from "../../../generated/PlanetSummary";
import type { StarClassView } from "../../../generated/StarClassView";
import type { SystemNode } from "../../../generated/SystemNode";
import {
  setStarClassOp,
  starBodies,
  starClassChoices,
  starClassRows,
} from "../../../lib/details/starClass";
import { useGameDataStore } from "../../../store/gameDataStore";
import { IconPicker, type IconPickerItem } from "../../IconPicker";
import { useApplyOp } from "../../useApplyOp";
import { useTextureUrl } from "../../useTextureUrl";

/** The side in pixels of a star icon whose class draws it at `icon_scale` 1. */
const ROW_ICON_PX = 10;
const TRIGGER_ICON_PX = 7;

/** The icon the map draws for `view`, sized by its `icon_scale`. */
function StarIcon({ view, base }: { view: StarClassView; base: number }) {
  const url = useTextureUrl([view.texture_key]);
  if (url === undefined) return null;
  const px = Math.round(base * view.icon_scale);
  return <img src={url} width={px} height={px} alt="" />;
}

/**
 * The star class at the head of a save's system: a picker of the classes with as many star
 * bodies as it has, or `label` as text when there are none to offer.
 */
export function StarClassPicker({
  system,
  planets,
  label,
}: {
  system: SystemNode;
  planets: readonly PlanetSummary[];
  label: string;
}) {
  const applyOp = useApplyOp();
  const names = useGameDataStore((s) => s.names);
  const starClasses = useGameDataStore((s) => s.starClasses);
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const bodies = starBodies(planets, planetClasses, starClasses);
  const choices = starClassChoices(system.star_class, bodies.length, starClasses);
  if (choices.length === 0) return <>{label}</>;

  const own = starClasses.get(system.star_class);
  const current: IconPickerItem = {
    key: system.star_class,
    label,
    icon: own && <StarIcon view={own} base={TRIGGER_ICON_PX} />,
  };
  const rows = starClassRows(choices, (key) => names.get(key) ?? key);
  const items: IconPickerItem[] = rows.map(({ view, label, group }) => ({
    key: view.key,
    label,
    group,
    icon: <StarIcon view={view} base={ROW_ICON_PX} />,
  }));
  const pick = (key: string) => {
    const target = starClasses.get(key);
    if (target) applyOp(setStarClassOp(system, target, bodies, starClasses));
  };
  return (
    <IconPicker
      label="Star class"
      title="Change the star class"
      current={current}
      items={items}
      onPick={pick}
    />
  );
}
