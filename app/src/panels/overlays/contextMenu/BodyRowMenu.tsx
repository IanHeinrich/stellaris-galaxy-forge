import { isStarBody } from "../../../lib/details/starBody";
import { useDetailsStore } from "../../../store/detailsStore";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import type { ContextTarget } from "../../../store/mapChromeStore";
import { canEnterSystem, useSceneStore } from "../../../store/sceneStore";
import { useSystemBodyNamer } from "../../inspector/entity/useBodyName";
import { MenuFrame, type Frame } from "./MenuFrame";
import { MenuItem } from "./MenuItem";

/** The way to a body in the system view, named for what the body is. */
function goToLabel(star: boolean, moon: boolean): string {
  if (star) return "Go to star";
  return moon ? "Go to moon" : "Go to planet";
}

/**
 * The menu on a body's row in an inspector list: the way to the body in its system's view, which
 * on the system already shown only selects it.
 */
export function BodyRowMenu({
  target,
  frame,
}: {
  target: Extract<ContextTarget, { kind: "bodyRow" }>;
  frame: Frame;
}) {
  const planet = useDetailsStore((s) =>
    s.details.get(target.system)?.planets.find((p) => p.id === target.id),
  );
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const starClasses = useGameDataStore((s) => s.starClasses);
  const enterable = useFileSessionStore(canEnterSystem);
  const goToBody = useSceneStore((s) => s.goToBody);
  const name = useSystemBodyNamer(target.system)(target.id);
  const star =
    planet !== undefined &&
    (planet.star_class !== undefined || isStarBody(planet.class, planetClasses, starClasses));
  // The rows sit in the dock at the window's right edge, so the menu opens left of the pointer.
  const style = { ...frame.style, transform: "translateX(-100%)" };
  return (
    <MenuFrame {...frame} style={style} label={name}>
      {name !== undefined && <div className="context-menu-header">{name}</div>}
      {enterable && planet !== undefined && (
        <MenuItem run={() => goToBody(target.system, target.id)}>
          {goToLabel(star, planet.moon)}
        </MenuItem>
      )}
    </MenuFrame>
  );
}
