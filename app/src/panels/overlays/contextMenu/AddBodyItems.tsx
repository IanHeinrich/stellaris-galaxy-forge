import { BODIES_NEED_GAME_DATA, RANDOM_BODY_LABEL, sizeRange } from "../../../lib/addBody";
import { PLANET_ICON_KEYS, planetTint } from "../../../lib/details/icons";
import { toCss } from "../../../lib/visual/ownerColors";
import { useGameDataStore } from "../../../store/gameDataStore";
import { Icon } from "../../parts";
import { useBodyClasses } from "../../useGeneratorData";
import { MenuItem } from "./MenuItem";
import { Submenu } from "./Submenu";

/** A class's art, as the game draws its planets in lists. */
function ClassArt({ planetClass }: { planetClass: string }) {
  const sprite = useGameDataStore((s) => s.planetClasses.get(planetClass)?.icon_sprite);
  return (
    <Icon
      className="body-pick-art"
      keys={sprite ? [`sprite:${sprite}`] : PLANET_ICON_KEYS}
      style={{ background: toCss(planetTint(planetClass)) }}
    />
  );
}

/**
 * A submenu of what a new planet, or with `moon` a new moon, can be: a random body first, then
 * each class with its art and the sizes a random one of it is drawn from. Picking one runs `add`
 * with the class, or null for a random one. Without game data the entry stays, disabled, with
 * the reason under it.
 */
export function AddBodyItems({
  label,
  moon,
  className,
  add,
}: {
  label: string;
  moon: boolean;
  className?: string;
  add: (planetClass: string | null) => unknown;
}) {
  const gameData = useGameDataStore((s) => s.status === "ready");
  const classes = useBodyClasses(moon);
  return (
    <Submenu
      label={label}
      className={className}
      hint={gameData ? undefined : BODIES_NEED_GAME_DATA}
      disabled={!gameData}
    >
      <MenuItem className="menu-item" run={() => add(null)}>
        {RANDOM_BODY_LABEL}
      </MenuItem>
      {(classes ?? []).map((pick, i) => (
        <MenuItem
          key={pick.key}
          className={i === 0 ? "menu-item pick-row context-menu-separated" : "menu-item pick-row"}
          run={() => add(pick.key)}
        >
          <ClassArt planetClass={pick.key} />
          {pick.name}
          <span className="count">{sizeRange(pick)}</span>
        </MenuItem>
      ))}
    </Submenu>
  );
}
