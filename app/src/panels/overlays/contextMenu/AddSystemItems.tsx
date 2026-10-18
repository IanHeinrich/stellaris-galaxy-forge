import type { AddSystemPicks } from "../../../generated/AddSystemPicks";
import type { StarClassPick } from "../../../store/generatorStore";
import { useEditorStore } from "../../../store/editorStore";
import { useMapChromeStore } from "../../../store/mapChromeStore";
import { useSpecialPickerStore } from "../../../store/specialPickerStore";
import { useAddSystemPreview } from "../../useAddSystemPreview";
import { useGeneratorData } from "../../useGeneratorData";
import { MenuItem } from "./MenuItem";
import { PickItem } from "./PickCard";
import { Submenu } from "./Submenu";

const ADD_SYSTEM_LABEL = "Add system here";
const RANDOM_LABEL = "Random";
const SPECIAL_LABEL = "Special…";

/**
 * The rolls "Add system here" offers: any regular system, one around a star class, each with its
 * card once the picks for this save are read, and Special…, which opens the Special picker.
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
  const menu = useMapChromeStore((s) => s.contextMenu);
  const openSpecial = useSpecialPickerStore((s) => s.openAt);
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
      {picks && picks.special.length > 0 && menu && (
        <MenuItem
          className="menu-item context-menu-separated"
          run={() => openSpecial({ x, y }, { x: menu.x, y: menu.y }, menu.perUnit)}
        >
          {SPECIAL_LABEL}
        </MenuItem>
      )}
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
  const refusal = useAddSystemPreview(x, y);

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
