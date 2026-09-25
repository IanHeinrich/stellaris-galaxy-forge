import type { PlanetSummary } from "../../../generated/PlanetSummary";
import type { SystemNode } from "../../../generated/SystemNode";
import {
  setPlanetSizeOp,
  setStarTypeOp,
  starTypeChoices,
  starTypeRows,
} from "../../../lib/details/starBody";
import { currentStarBodies, STARS_NEED_GAME_DATA } from "../../../lib/details/starClass";
import { useDetailsStore } from "../../../store/detailsStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { EditBlock, EditRow, PickerField, TextField } from "../../EditField";
import type { IconPickerItem } from "../../IconPicker";
import { useApplyOp } from "../../useApplyOp";
import { StarRowIcon, StarTriggerIcon } from "../StarIcon";
import { READING_STARS } from "../system/StarClassLine";
import { useNamed } from "../../useNamed";
import { useSingleStarClasses } from "./useBodyClasses";

const NO_CHOICE = "The game data has no other star type";
const NO_SIZE = "The save gives this body no size";

/**
 * A star body's type, as a field offering every planet class the game flags `star`. Like the
 * system's star class it waits, disabled, while the system's details are unread or stale.
 */
function StarTypeField({ planet, system }: { planet: PlanetSummary; system: SystemNode }) {
  const applyOp = useApplyOp();
  const singles = useSingleStarClasses();
  const gameData = useGameDataStore((s) => s.status === "ready");
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const starClasses = useGameDataStore((s) => s.starClasses);
  const stale = useDetailsStore((s) => s.stale.has(system.id));
  const read = useDetailsStore((s) => s.details.get(system.id));
  const fresh = currentStarBodies(read, stale, planetClasses, starClasses);
  const choices = starTypeChoices(planet.class, planetClasses);
  const label = useNamed([planet.class, ...choices]);

  const icon = (key: string, Icon: typeof StarRowIcon) => {
    const view = singles.get(key);
    return view && <Icon view={view} />;
  };
  const items: IconPickerItem[] = starTypeRows(choices, label).map((row) => ({
    ...row,
    icon: icon(row.key, StarRowIcon),
  }));
  const current: IconPickerItem = {
    key: planet.class,
    label: label(planet.class),
    icon: icon(planet.class, StarTriggerIcon),
  };
  const reason = !gameData
    ? STARS_NEED_GAME_DATA
    : fresh === null
      ? READING_STARS
      : choices.length === 0
        ? NO_CHOICE
        : undefined;
  return (
    <PickerField
      label="Star type"
      title="Change this star's type. The system's star class follows when a class has these stars."
      disabledReason={reason}
      current={current}
      items={items}
      onPick={(key) => {
        if (fresh) applyOp(setStarTypeOp(system, fresh, planet.id, key, starClasses));
      }}
    />
  );
}

/** A body's size as a whole number of at least 1; anything else puts the field back. */
function SizeField({ planet }: { planet: PlanetSummary }) {
  const applyOp = useApplyOp();
  const size = planet.size;
  if (size === null) {
    return (
      <TextField
        kind="text"
        label="Size"
        value="none"
        disabledReason={NO_SIZE}
        onCommit={() => undefined}
      />
    );
  }
  return (
    <TextField
      kind="number"
      label="Size"
      title="Change the body's size"
      value={size}
      onCommit={(next) => {
        const op = setPlanetSizeOp(planet.id, size, next);
        if (op !== null) applyOp(op);
      }}
    />
  );
}

/** A save star body's type and size, the fields its page opens with. */
export function StarBlock({ planet, system }: { planet: PlanetSummary; system: SystemNode }) {
  return (
    <EditBlock title="Star">
      <EditRow label="Star type">
        <StarTypeField planet={planet} system={system} />
      </EditRow>
      <EditRow label="Size">
        <SizeField planet={planet} />
      </EditRow>
    </EditBlock>
  );
}
