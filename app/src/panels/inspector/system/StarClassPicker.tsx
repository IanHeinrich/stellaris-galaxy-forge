import type { PlanetSummary } from "../../../generated/PlanetSummary";
import type { SystemNode } from "../../../generated/SystemNode";
import {
  currentStarBodies,
  setStarClassOp,
  starBodies,
  starClassChoices,
} from "../../../lib/details/starClass";
import { useDetailsStore } from "../../../store/detailsStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { IconPicker, type IconPickerItem } from "../../IconPicker";
import { useApplyOp } from "../../useApplyOp";
import { StarTriggerIcon } from "../StarIcon";
import { useStarClassItems } from "../useStarClassItems";

/**
 * The star class at the head of a save's system: a picker of the classes with as many star
 * bodies as it has, or `label` as text when there are none to offer. It waits while an edit has
 * left the details stale.
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
  const stale = useDetailsStore((s) => s.stale.has(system.id));
  const bodies = starBodies(planets, planetClasses, starClasses);
  const fresh = currentStarBodies({ planets }, stale, planetClasses, starClasses);
  const choices = starClassChoices(system.star_class, bodies.length, starClasses);
  const items = useStarClassItems(choices);
  if (choices.length === 0) return <>{label}</>;

  const own = starClasses.get(system.star_class);
  const shown: IconPickerItem = {
    key: system.star_class,
    label,
    icon: own && <StarTriggerIcon view={own} />,
  };
  const pick = (key: string) => {
    const target = starClasses.get(key);
    if (target && fresh) applyOp(setStarClassOp(system, target, fresh, starClasses));
  };
  return (
    <IconPicker
      label="Star class"
      title={fresh ? "Change the star class" : "Reading the system's stars…"}
      disabled={fresh === null}
      current={shown}
      items={items}
      onPick={pick}
    />
  );
}
