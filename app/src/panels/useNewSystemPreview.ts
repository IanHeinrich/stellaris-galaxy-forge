import { useEffect, useMemo } from "react";
import type { Pt } from "../lib/geometry/pt";
import type { Rect } from "../lib/menuAim";
import type { ShapePreview } from "../lib/shapes/types";
import { previewArea, specialPlacement, type NewSystems } from "../lib/specialPicks";
import { useGalaxyStore } from "../store/galaxyStore";
import { useMapChromeStore } from "../store/mapChromeStore";
import { useSpecialLinks } from "../store/specialLinks";

/**
 * Draws `added` on the map, with its lanes to the systems near it when `join`, as the Shape tool
 * draws a shape's systems, while the caller shows; and answers the box in the map area's pixels
 * round what it draws and the spawn ring round `at`, which the map shows at `anchor`.
 */
export function useNewSystemPreview(
  added: NewSystems | null,
  join: boolean,
  at: Pt,
  anchor: Pt,
  perUnit: Pt,
): { preview: ShapePreview | null; area: Rect } {
  const setPreview = useMapChromeStore((s) => s.setSpecialPreview);
  const links = useSpecialLinks(join ? added : null);
  const preview = useMemo(() => added && specialPlacement(added, links), [added, links]);
  useEffect(() => {
    setPreview(preview);
    return () => setPreview(null);
  }, [preview, setPreview]);
  const systems = useGalaxyStore((s) => s.systems);
  const area = useMemo(
    () => previewArea(preview, systems, at, anchor, perUnit),
    [preview, systems, at, anchor, perUnit],
  );
  return { preview, area };
}
