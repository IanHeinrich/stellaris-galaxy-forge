import { useEffect } from "react";
import type { AddRefusal } from "../lib/addSystem";
import { useAddSystemRefusal } from "../store/editorStore";
import { useMapChromeStore } from "../store/mapChromeStore";

/**
 * Why a system cannot go at the world point, or null when it can, while the map draws the spawn
 * buffer around the point, and the galaxy's reach when the point is past it, for as long as the
 * caller is shown.
 */
export function useAddSystemPreview(x: number, y: number): AddRefusal | null {
  const setPreview = useMapChromeStore((s) => s.setAddSystemPreview);
  const refusal = useAddSystemRefusal(x, y);
  const tooClose = refusal?.limit === "tooClose";
  const edge = refusal?.limit === "outside" ? refusal.reach : null;

  useEffect(() => {
    setPreview({ x, y, tooClose, edge });
    return () => setPreview(null);
  }, [x, y, tooClose, edge, setPreview]);

  return refusal;
}
