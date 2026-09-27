import { Container, Graphics } from "pixi.js";
import { SAVE_X_SIGN, SAVE_Y_SIGN } from "../../../lib/geometry/geometry";
import type { Camera } from "../../Camera";
import { markerScale } from "../../layers/MapLayer";
import { EMPTY_SYSTEM_CONTEXT, type SystemContext } from "../context";
import { drawnDisc } from "../geometry";
import type { SystemLayer } from "./SystemLayer";

const LOCK_COLOR = 0xc8d0dc;
const LOCK_ALPHA = 0.7;
/** The padlock's height, and its gap past the drawn disc, in screen pixels before the marker factor. */
const LOCK_PX = 8;
const LOCK_GAP_PX = 2;
const SHACKLE_WIDTH_PX = 1.25;
const SHACKLE_STEPS = 8;

/** A small padlock above and to the right of each body locked to what it orbits. */
export class LocksLayer implements SystemLayer {
  readonly container = new Container();
  readonly locks = new Graphics();
  private ctx: SystemContext = EMPTY_SYSTEM_CONTEXT;
  private drawnScale = -1;

  constructor() {
    this.locks.label = "locks";
    this.container.addChild(this.locks);
  }

  rebuild(ctx: SystemContext): void {
    if (ctx.bodyById === this.ctx.bodyById && ctx.lockedBodies === this.ctx.lockedBodies) return;
    this.ctx = ctx;
    this.drawnScale = -1;
  }

  onViewport(cam: Camera): void {
    if (cam.scale === this.drawnScale) return;
    this.drawnScale = cam.scale;
    const g = this.locks.clear();
    const px = 1 / cam.scale;
    const size = LOCK_PX * markerScale(cam.scale) * px;
    for (const id of this.ctx.lockedBodies) {
      const body = this.ctx.bodyById.get(id)?.placement;
      if (!body) continue;
      const out = (drawnDisc(body.disc, cam.scale) + LOCK_GAP_PX * px + size / 2) * Math.SQRT1_2;
      // Laid out right and up on screen, whichever way the save's axes run.
      const at = (right: number, up: number) => ({
        x: body.x + SAVE_X_SIGN * (out + right * size),
        y: body.y - SAVE_Y_SIGN * (out + up * size),
      });
      const corners = [at(-0.4, -0.5), at(0.4, -0.5), at(0.4, 0), at(-0.4, 0)];
      g.poly(corners.flatMap((p) => [p.x, p.y])).fill({ color: LOCK_COLOR, alpha: LOCK_ALPHA });
      const foot = at(-0.25, 0);
      g.moveTo(foot.x, foot.y);
      for (let i = 0; i <= SHACKLE_STEPS; i++) {
        const turn = (Math.PI * i) / SHACKLE_STEPS;
        const p = at(-0.25 * Math.cos(turn), 0.25 * Math.sin(turn) + 0.15);
        g.lineTo(p.x, p.y);
      }
      const end = at(0.25, 0);
      g.lineTo(end.x, end.y);
      g.stroke({ color: LOCK_COLOR, alpha: LOCK_ALPHA, width: SHACKLE_WIDTH_PX * px });
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
