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
import { PickerField } from "../../EditField";
import type { IconPickerItem } from "../../IconPicker";
import { useApplyOp } from "../../useApplyOp";
import { StarTriggerIcon } from "../StarIcon";
import { useStarClassItems } from "../useStarClassItems";

const READING_STARS = "Reading the system's stars…";
const NEEDS_GAME_DATA = "Load game data to change the star class";
const NO_CHOICE = "No other star class has as many stars as this system";

/**
 * A save system's star class, as a field offering the classes with as many star bodies as it
 * has. It waits, disabled, until the system's details are read and while an edit has left them
 * stale, and says why when there is nothing to offer.
 */
export function StarClassPicker({
  system,
  planets,
  label,
}: {
  system: SystemNode;
  planets: readonly PlanetSummary[] | undefined;
  label: string;
}) {
  const applyOp = useApplyOp();
  const starClasses = useGameDataStore((s) => s.starClasses);
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const stale = useDetailsStore((s) => s.stale.has(system.id));
  const read = planets === undefined ? undefined : { planets };
  const bodies = starBodies(planets ?? [], planetClasses, starClasses);
  const fresh = currentStarBodies(read, stale, planetClasses, starClasses);
  const choices = starClassChoices(system.star_class, bodies.length, starClasses);
  const items = useStarClassItems(choices);

  const own = starClasses.get(system.star_class);
  const shown: IconPickerItem = {
    key: system.star_class,
    label,
    icon: own && <StarTriggerIcon view={own} />,
  };
  const reason =
    starClasses.size === 0
      ? NEEDS_GAME_DATA
      : fresh === null
        ? READING_STARS
        : choices.length === 0
          ? NO_CHOICE
          : undefined;
  const pick = (key: string) => {
    const target = starClasses.get(key);
    if (target && fresh) applyOp(setStarClassOp(system, target, fresh, starClasses));
  };
  return (
    <PickerField
      label="Star class"
      title="Change the star class"
      disabledReason={reason}
      current={shown}
      items={items}
      onPick={pick}
    />
  );
}
