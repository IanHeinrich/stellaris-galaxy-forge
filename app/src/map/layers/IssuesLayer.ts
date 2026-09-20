import { Container, Graphics } from "pixi.js";
import type { GalaxyDelta } from "../../generated/GalaxyDelta";
import type { Issue } from "../../generated/Issue";
import type { Severity } from "../../generated/Severity";
import type { Camera } from "../Camera";
import { EMPTY_CONTEXT, type RenderContext, type Systems } from "../RenderContext";
import { markerScale, type MapLayer } from "./MapLayer";

const RADIUS = 18;
const WIDTH = 2;
const ALPHA = 0.85;
export const SEVERITY_COLOR: Record<Severity, number> = {
  warning: 0xf59e0b,
  error: 0xef4444,
};

function draw(g: Graphics, severity: Severity): void {
  g.clear();
  g.circle(0, 0, RADIUS).stroke({ color: SEVERITY_COLOR[severity], width: WIDTH, alpha: ALPHA });
}

/** Errors win over warnings for a system named by both. */
export function worstSeverityBySystem(issues: readonly Issue[]): Map<number, Severity> {
  const worst = new Map<number, Severity>();
  for (const issue of issues) {
    for (const id of issue.systems) {
      if (issue.severity === "error" || !worst.has(id)) worst.set(id, issue.severity);
    }
  }
  return worst;
}

/** A tint ring, screen-sized like a marker, around every system the validator names. */
export class IssuesLayer implements MapLayer {
  readonly id = "issues" as const;
  readonly container = new Container();
  private readonly rings = new Map<number, Graphics>();
  private galaxy = EMPTY_CONTEXT.galaxy;
  private systems: Systems = EMPTY_CONTEXT.systems;
  private severities = new Map<number, Severity>();
  private readonly scale = { x: 1, y: 1 };

  rebuild(ctx: RenderContext): void {
    const loaded = ctx.galaxy !== this.galaxy;
    this.galaxy = ctx.galaxy;
    this.systems = ctx.systems;
    if (loaded) this.place();
  }

  applyDelta(d: GalaxyDelta): void {
    for (const id of d.removed ?? []) {
      this.rings.get(id)?.destroy();
      this.rings.delete(id);
    }
    for (const s of d.systems) this.rings.get(s.id)?.position.set(s.x, s.y);
  }

  setIssues(issues: readonly Issue[]): void {
    this.severities = worstSeverityBySystem(issues);
    this.place();
  }

  onViewport(cam: Camera): void {
    cam.childScale(markerScale(cam.scale), this.scale);
    for (const g of this.rings.values()) g.scale.set(this.scale.x, this.scale.y);
  }

  setVisible(v: boolean): void {
    this.container.visible = v;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }

  private place(): void {
    for (const [id, ring] of this.rings) {
      if (!this.severities.has(id) || !this.systems.has(id)) {
        ring.destroy();
        this.rings.delete(id);
      }
    }
    for (const [id, severity] of this.severities) {
      const s = this.systems.get(id);
      if (!s) continue;
      let ring = this.rings.get(id);
      if (!ring) {
        ring = new Graphics();
        ring.scale.set(this.scale.x, this.scale.y);
        this.rings.set(id, ring);
        this.container.addChild(ring);
      }
      draw(ring, severity);
      ring.position.set(s.x, s.y);
    }
  }
}
