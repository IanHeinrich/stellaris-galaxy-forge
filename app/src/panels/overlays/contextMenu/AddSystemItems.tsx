import type { AddSystemPicks } from "../../../generated/AddSystemPicks";
import { starPicksByCount } from "../../../lib/details/starClass";
import type { StarClassPick } from "../../../store/generatorStore";
import { useEditorStore } from "../../../store/editorStore";
import { useGameDataStore } from "../../../store/gameDataStore";
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
const BINARY_LABEL = "Binary stars";
const TRINARY_LABEL = "Trinary stars";

/** One row per star class, each rolling a system around that class. */
function StarClassRows({
  x,
  y,
  stars,
  first = "menu-item",
}: {
  x: number;
  y: number;
  stars: readonly StarClassPick[];
  /** The first row's class. */
  first?: string;
}) {
  const addRandomSystemAt = useEditorStore((s) => s.addRandomSystemAt);
  return stars.map((c, i) => (
    <PickItem
      key={c.key}
      className={i === 0 ? first : "menu-item"}
      title={c.label}
      summary={c.summary}
      run={() => addRandomSystemAt(x, y, c.key)}
    >
      {c.label}
    </PickItem>
  ));
}

/**
 * The star class rolls: a row per single star, then a submenu each for the binaries and the
 * trinaries, shown once the generator offers one, its rows named by their stars.
 */
export function StarClassItems({
  x,
  y,
  stars,
}: {
  x: number;
  y: number;
  stars: readonly StarClassPick[];
}) {
  const views = useGameDataStore((s) => s.starClasses);
  const { rows, binaries, trinaries } = starPicksByCount(stars, views);
  return (
    <>
      <StarClassRows x={x} y={y} stars={rows} first="menu-item context-menu-separated" />
      {binaries.length > 0 && (
        <Submenu label={BINARY_LABEL}>
          <StarClassRows x={x} y={y} stars={binaries} />
        </Submenu>
      )}
      {trinaries.length > 0 && (
        <Submenu label={TRINARY_LABEL}>
          <StarClassRows x={x} y={y} stars={trinaries} />
        </Submenu>
      )}
    </>
  );
}

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
      <StarClassItems x={x} y={y} stars={stars} />
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
