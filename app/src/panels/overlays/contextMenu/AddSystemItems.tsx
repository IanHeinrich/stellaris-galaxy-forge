import { useEffect } from "react";
import { addSystemRefusal } from "../../../lib/addSystem";
import { useSystemNames } from "../../../store/browserRows";
import { nearestSystem, useEditorStore } from "../../../store/editorStore";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useGeneratorStore } from "../../../store/generatorStore";
import { useMapChromeStore } from "../../../store/mapChromeStore";
import { MenuItem } from "./MenuItem";
import { NO_SYSTEMS } from "./menuState";
import { Submenu } from "./Submenu";

const ADD_SYSTEM_LABEL = "Add system here";
const RANDOM_LABEL = "Random";

/** The rolls "Add system here" offers: any regular system, or one around a star class. */
function Rolls({ x, y }: { x: number; y: number }) {
  const addRandomSystemAt = useEditorStore((s) => s.addRandomSystemAt);
  const starClasses = useGeneratorStore((s) => s.starClasses);
  return (
    <>
      <MenuItem className="menu-item" run={() => addRandomSystemAt(x, y)}>
        {RANDOM_LABEL}
      </MenuItem>
      {starClasses?.map((c, i) => (
        <MenuItem
          key={c.key}
          className={i === 0 ? "menu-item context-menu-separated" : "menu-item"}
          run={() => addRandomSystemAt(x, y, c.key)}
        >
          {c.label}
        </MenuItem>
      ))}
    </>
  );
}

/**
 * What the menu on a save's empty space offers for a new system there. A spot the core would
 * refuse keeps the entry, disabled, with the reason under it; the map draws the spawn buffer
 * around the spot while the menu is open.
 */
export function AddSystemItems({ x, y }: { x: number; y: number }) {
  const systems = useGalaxyStore((s) => s.systems);
  const radius = useGalaxyStore((s) => s.galaxy?.galaxy_radius ?? 0);
  const meta = useFileSessionStore((s) => s.meta);
  const gameData = useGameDataStore((s) => s.status === "ready");
  const request = useGeneratorStore((s) => s.request);
  const setPreview = useMapChromeStore((s) => s.setAddSystemPreview);
  const near = nearestSystem({ x, y }, systems.values());
  const [nearName] = useSystemNames(near ? [near.id] : NO_SYSTEMS);
  const nearest = near && {
    name: nearName ?? `#${near.id}`,
    distance: Math.hypot(near.x - x, near.y - y),
  };
  const refusal = addSystemRefusal({ meta, gameData, radius, x, y, nearest });
  const tooClose = refusal?.tooClose ?? false;
  const edge = refusal?.outside ? radius : null;

  useEffect(() => {
    if (gameData) request();
  }, [gameData, request]);
  useEffect(() => {
    setPreview({ x, y, tooClose, edge });
    return () => setPreview(null);
  }, [x, y, tooClose, edge, setPreview]);

  return (
    <Submenu
      label={ADD_SYSTEM_LABEL}
      hint={refusal?.reason}
      disabled={refusal !== null}
      title={refusal?.reason}
    >
      <Rolls x={x} y={y} />
    </Submenu>
  );
}
