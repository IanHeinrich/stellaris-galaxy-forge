import { documentCapabilities } from "../../lib/capabilities";
import { discRadius } from "../../lib/details/discs";
import { polar } from "../../lib/details/orbits";
import { placementAt } from "../../lib/planetMove";
import { useDetailsStore } from "../../store/detailsStore";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { usePlanetMoveStore, type PlanetCut } from "../../store/planetMoveStore";
import type { PasteGhost, SceneHighlight } from "./layers/SystemLayer";

export type MoveMarks = Pick<SceneHighlight, "selectedBodies" | "cutBodies" | "pasteGhost">;

const NONE: readonly number[] = [];

/**
 * What the scene marks of planets being moved in system `id`: the bodies selected there, the
 * bodies cut from there, and the ghost of a lone cut planet while a menu to paste it here is open.
 * On a document whose planets cannot move, the one body selected is the inspected one, ringed
 * already, and nothing comes along with it.
 */
export function moveMarks(id: number | null): MoveMarks {
  const { selection, cut } = usePlanetMoveStore.getState();
  const movable = documentCapabilities(useFileSessionStore.getState()).details;
  return {
    selectedBodies: movable && id !== null && selection?.system === id ? selection.ids : NONE,
    cutBodies: id !== null && cut?.from === id ? cut.planets : NONE,
    pasteGhost: id === null ? null : pasteGhost(id, cut),
  };
}

/** Where the one planet of `cut` lands in system `id` at the point its open menu was asked at. */
function pasteGhost(id: number, cut: PlanetCut | null): PasteGhost | null {
  const target = useMapChromeStore.getState().contextMenu?.target;
  if (target?.kind !== "systemSpace" || target.system !== id) return null;
  if (cut === null || cut.planets.length !== 1 || cut.from === id) return null;
  const at = placementAt(target.x, target.y);
  const { x, y } = polar(0, 0, at.radius, at.angle);
  const planet = useDetailsStore
    .getState()
    .details.get(cut.from)
    ?.planets.find((p) => p.id === cut.planets[0]);
  const view = planet ? useGameDataStore.getState().planetClasses.get(planet.class) : undefined;
  return { x, y, radius: at.radius, disc: discRadius(planet?.size ?? null, { view }) };
}
