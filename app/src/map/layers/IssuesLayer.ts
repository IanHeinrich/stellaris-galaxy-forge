import { Circle, Container, type FederatedPointerEvent, Graphics } from "pixi.js";
import type { GalaxyDelta } from "../../generated/GalaxyDelta";
import type { Severity } from "../../generated/Severity";
import { issueCopy } from "../../lib/issueCopy";
import type { AppIssue } from "../../lib/issues";
import { titleCase } from "../../lib/text";
import { OwnedTooltip } from "../ownedTooltip";
import type { Camera } from "../Camera";
import { EMPTY_CONTEXT, type RenderContext, type Systems } from "../RenderContext";
import { destroyChildren } from "./destroyChildren";
import { markerScale, type MapLayer } from "./MapLayer";
import { RING_RADIUS } from "../../lib/visual/style";

const RADIUS = RING_RADIUS.issue;
const WIDTH = 2;
const ALPHA = 0.85;
export const SEVERITY_COLOR: Record<Severity, number> = {
  info: 0x60a5fa,
  warning: 0xf59e0b,
  error: 0xef4444,
};

/** The ring's own hit area: the disc it encloses, clear of the star's own hover and drag. */
const HIT = new Circle(0, 0, RADIUS);

function draw(g: Graphics, severity: Severity): void {
  g.clear();
  g.circle(0, 0, RADIUS).stroke({ color: SEVERITY_COLOR[severity], width: WIDTH, alpha: ALPHA });
}

const SEVERITY_RANK: Record<Severity, number> = { info: 0, warning: 1, error: 2 };

/** The most severe issue naming each system; the first of equals stays. */
export function worstIssueBySystem(issues: readonly AppIssue[]): Map<number, AppIssue> {
  const worst = new Map<number, AppIssue>();
  for (const issue of issues) {
    for (const id of issue.systems) {
      const held = worst.get(id);
      if (!held || SEVERITY_RANK[issue.severity] > SEVERITY_RANK[held.severity]) {
        worst.set(id, issue);
      }
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
  private issues = new Map<number, AppIssue>();
  private readonly scale = { x: 1, y: 1 };
  private hovered: number | null = null;
  private readonly tip = new OwnedTooltip();

  rebuild(ctx: RenderContext): void {
    const loaded = ctx.galaxy !== this.galaxy;
    this.galaxy = ctx.galaxy;
    this.systems = ctx.systems;
    if (loaded) this.place();
  }

  applyDelta(d: GalaxyDelta): void {
    this.remove(d.removed ?? []);
    for (const s of d.systems) this.rings.get(s.id)?.position.set(s.x, s.y);
  }

  setIssues(issues: readonly AppIssue[]): void {
    this.issues = worstIssueBySystem(issues);
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
    this.remove(
      [...this.rings.keys()].filter((id) => !this.issues.has(id) || !this.systems.has(id)),
    );
    for (const [id, issue] of this.issues) {
      const s = this.systems.get(id);
      if (!s) continue;
      let ring = this.rings.get(id);
      if (!ring) {
        ring = this.makeRing(id);
        this.rings.set(id, ring);
        this.container.addChild(ring);
      }
      draw(ring, issue.severity);
      ring.position.set(s.x, s.y);
    }
  }

  private makeRing(id: number): Graphics {
    const ring = new Graphics();
    ring.scale.set(this.scale.x, this.scale.y);
    ring.eventMode = "static";
    ring.cursor = "help";
    ring.hitArea = HIT;
    ring.on("pointerover", (e: FederatedPointerEvent) => this.hover(id, e.global));
    ring.on("pointerout", () => this.unhover(id));
    return ring;
  }

  private hover(id: number, at: { x: number; y: number }): void {
    const issue = this.issues.get(id);
    if (!issue) return;
    const copy = issueCopy(issue.code);
    this.hovered = id;
    this.tip.show({
      x: at.x,
      y: at.y,
      title: titleCase([issue.severity]),
      lines: [copy.title, copy.why],
    });
  }

  private unhover(id: number): void {
    if (this.hovered !== id) return;
    this.hovered = null;
    this.tip.hide();
  }

  private remove(ids: readonly number[]): void {
    const doomed = new Set<Container>();
    for (const id of ids) {
      const ring = this.rings.get(id);
      if (!ring) continue;
      this.unhover(id);
      doomed.add(ring);
      this.rings.delete(id);
    }
    destroyChildren(this.container, doomed);
  }
}
