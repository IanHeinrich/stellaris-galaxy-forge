import { useMemo } from "react";
import type { AddSystemPicks } from "../../../generated/AddSystemPicks";
import { crisisVariantKeys, withoutMultiStars } from "../../../lib/details/starClass";
import {
  gameStarSets,
  randomStarsCard,
  STAR_COUNTS,
  starSetNoun,
  type StarCount,
} from "../../../lib/multiStar";
import type { StarClassPick } from "../../../store/generatorStore";
import { useEditorStore } from "../../../store/editorStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useMapChromeStore } from "../../../store/mapChromeStore";
import { useSpecialPickerStore } from "../../../store/specialPickerStore";
import { useStarBuilderStore } from "../../../store/starBuilderStore";
import { useAddSystemPreview } from "../../useAddSystemPreview";
import { useGeneratorData, useStarData } from "../../useGeneratorData";
import { MenuItem } from "./MenuItem";
import { PickItem } from "./PickCard";
import { Submenu } from "./Submenu";

const ADD_SYSTEM_LABEL = "Add system here";
const RANDOM_LABEL = "Random";
const SPECIAL_LABEL = "Special…";
const MULTI_STAR_LABEL = "Binary or trinary";
const BUILD_LABEL = "Build one…";

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

/** The star class rolls: a row per class, less the binaries and trinaries "Binary or trinary" offers. */
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
  const rows = withoutMultiStars(stars, views);
  return <StarClassRows x={x} y={y} stars={rows} first="menu-item context-menu-separated" />;
}

/** A random binary or trinary, with a card saying which stars it draws from and how it arranges them. */
function RandomStarsRow({ x, y, count }: { x: number; y: number; count: StarCount }) {
  const addRandomStarsAt = useEditorStore((s) => s.addRandomStarsAt);
  const views = useGameDataStore((s) => s.starClasses);
  const { arrangements } = useStarData();
  const lines = useMemo(() => {
    const sets = gameStarSets(views.values(), count, crisisVariantKeys(views.values())).length;
    return randomStarsCard(count, arrangements ?? [], sets);
  }, [views, arrangements, count]);
  const label = `Random ${starSetNoun(count).one}`;
  return (
    <PickItem
      className="menu-item"
      title={label}
      lines={lines}
      run={() => addRandomStarsAt(x, y, count)}
    >
      {label}
    </PickItem>
  );
}

/** What Binary or trinary offers: a random binary, a random trinary, and the builder. */
export function MultiStarRows({ x, y }: { x: number; y: number }) {
  const menu = useMapChromeStore((s) => s.contextMenu);
  const openBuilder = useStarBuilderStore((s) => s.openAt);
  return (
    <>
      {STAR_COUNTS.map((count) => (
        <RandomStarsRow key={count} x={x} y={y} count={count} />
      ))}
      {menu && (
        <MenuItem
          className="menu-item context-menu-separated"
          run={() => openBuilder({ x, y }, { x: menu.x, y: menu.y }, menu.perUnit)}
        >
          {BUILD_LABEL}
        </MenuItem>
      )}
    </>
  );
}

function MultiStarItems({ x, y }: { x: number; y: number }) {
  return (
    <Submenu label={MULTI_STAR_LABEL}>
      <MultiStarRows x={x} y={y} />
    </Submenu>
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
      <MultiStarItems x={x} y={y} />
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
