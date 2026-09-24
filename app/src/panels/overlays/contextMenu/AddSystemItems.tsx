import { useEffect } from "react";
import { addSystemRefusal } from "../../../lib/addSystem";
import { useSystemNames } from "../../../store/browserRows";
import { nearestSystem, useEditorStore } from "../../../store/editorStore";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useGeneratorStore } from "../../../store/generatorStore";
import { useMapChromeStore } from "../../../store/mapChromeStore";
import { NO_SYSTEMS } from "./menuState";
import { PickItem } from "./PickCard";
import { SpecialItems } from "./SpecialItems";
import { Submenu } from "./Submenu";

const ADD_SYSTEM_LABEL = "Add system here";
const RANDOM_LABEL = "Random";

/**
 * The rolls "Add system here" offers: any regular system, one around a star class, and the
 * game's special layouts, each with its card once the picks for this save are read.
 */
function Rolls({ x, y }: { x: number; y: number }) {
  const addRandomSystemAt = useEditorStore((s) => s.addRandomSystemAt);
  const starClasses = useGeneratorStore((s) => s.starClasses);
  const picks = useGeneratorStore((s) => s.picks);
  const stars =
    picks?.star_classes.map((p) => ({ key: p.key, label: p.name, summary: p.summary })) ??
    starClasses?.map((c) => ({ ...c, summary: undefined })) ??
    [];
  return (
    <>
      <PickItem
        className="menu-item"
        title={RANDOM_LABEL}
        summary={picks?.random}
        run={() => addRandomSystemAt(x, y)}
      >
        {RANDOM_LABEL}
      </PickItem>
      {stars.map((c, i) => (
        <PickItem
          key={c.key}
          className={i === 0 ? "menu-item context-menu-separated" : "menu-item"}
          title={c.label}
          summary={c.summary}
          run={() => addRandomSystemAt(x, y, c.key)}
        >
          {c.label}
        </PickItem>
      ))}
      {picks && picks.special.length > 0 && <SpecialItems x={x} y={y} picks={picks.special} />}
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
  const refreshPicks = useGeneratorStore((s) => s.refreshPicks);
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
    if (!gameData) return;
    request();
    refreshPicks();
  }, [gameData, request, refreshPicks]);
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
