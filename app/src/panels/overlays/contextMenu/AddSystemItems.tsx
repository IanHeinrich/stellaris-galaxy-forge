import { useEffect } from "react";
import type { AddSystemPicks } from "../../../generated/AddSystemPicks";
import type { StarClassPick } from "../../../store/generatorStore";
import { useAddSystemRefusal, useEditorStore } from "../../../store/editorStore";
import { useMapChromeStore } from "../../../store/mapChromeStore";
import { useGeneratorData } from "../../useGeneratorData";
import { PickItem } from "./PickCard";
import { SpecialItems } from "./SpecialItems";
import { Submenu } from "./Submenu";

const ADD_SYSTEM_LABEL = "Add system here";
const RANDOM_LABEL = "Random";

/**
 * The rolls "Add system here" offers: any regular system, one around a star class, and the
 * game's special layouts, each with its card once the picks for this save are read.
 */
function Rolls({
  x,
  y,
  picks,
  stars,
}: {
  x: number;
  y: number;
  picks: AddSystemPicks | null;
  stars: readonly StarClassPick[];
}) {
  const addRandomSystemAt = useEditorStore((s) => s.addRandomSystemAt);
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
  const { picks, stars } = useGeneratorData(true);
  const setPreview = useMapChromeStore((s) => s.setAddSystemPreview);
  const refusal = useAddSystemRefusal(x, y);
  const tooClose = refusal?.limit === "tooClose";
  const edge = refusal?.limit === "outside" ? refusal.radius : null;

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
      <Rolls x={x} y={y} picks={picks} stars={stars} />
    </Submenu>
  );
}
