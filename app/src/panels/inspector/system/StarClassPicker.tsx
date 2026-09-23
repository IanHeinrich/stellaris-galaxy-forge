import type { PlanetSummary } from "../../../generated/PlanetSummary";
import type { SystemNode } from "../../../generated/SystemNode";
import { setStarClassOp, starBodies, starClassChoices } from "../../../lib/details/starClass";
import { useGameDataStore } from "../../../store/gameDataStore";
import { IconPicker, type IconPickerItem } from "../../IconPicker";
import { useApplyOp } from "../../useApplyOp";
import { StarTriggerIcon } from "../StarIcon";
import { useStarClassItems } from "../useStarClassItems";

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
  const starClasses = useGameDataStore((s) => s.starClasses);
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const bodies = starBodies(planets, planetClasses, starClasses);
  const choices = starClassChoices(system.star_class, bodies.length, starClasses);
  const items = useStarClassItems(choices);
  if (choices.length === 0) return <>{label}</>;

  const own = starClasses.get(system.star_class);
  const current: IconPickerItem = {
    key: system.star_class,
    label,
    icon: own && <StarTriggerIcon view={own} />,
  };
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
