import type { Graphics } from "pixi.js";
import { dashedCircle } from "../../layers/dashes";

/**
 * The dashed halo round what the game may not place: its gap past the drawn edge and its width in
 * screen pixels, its dashes, colour and alpha.
 */
const HALO_GAP_PX = 6;
const HALO_WIDTH_PX = 1;
const HALO_DASHES = 16;
const HALO_COLOUR = 0xc7cfdc;
const HALO_ALPHA = 0.7;

/** Draws `halo` about (x, y), just outside `radius` world units, at camera scale `scale`. */
export function drawHalo(halo: Graphics, radius: number, scale: number, x = 0, y = 0): void {
  halo.clear();
  dashedCircle(halo, x, y, radius + HALO_GAP_PX / scale, HALO_DASHES);
  halo.stroke({ color: HALO_COLOUR, width: HALO_WIDTH_PX / scale, alpha: HALO_ALPHA });
}
