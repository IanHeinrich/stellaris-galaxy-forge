import { Container } from "pixi.js";
import type { GalaxyDelta } from "../../generated/GalaxyDelta";
import type { Outcome } from "../../lib/prepareCopy";
import { OUTCOME_COLORS, OUTCOME_STROKES } from "../../lib/visual/outcomeColors";
import { RING_RADIUS } from "../../lib/visual/style";
import type { Camera } from "../Camera";
import { EMPTY_CONTEXT, type RenderContext, type Systems } from "../RenderContext";
import { DrawnPositions, movedAny, type DrawnChange } from "../drawnPositions";
import { pointsOf, RingBatches, type RingSpec, type WantedRings } from "./highlights/RingBatch";
import { markerScale, type MapLayer } from "./MapLayer";

function specOf(outcome: Outcome): RingSpec {
  return {
    color: OUTCOME_COLORS[outcome],
    radius: RING_RADIUS.outcome,
    ...OUTCOME_STROKES[outcome],
  };
}

/**
 * A ring in its outcome's colour round every system the Prepare choices change: an ordinary
 * star, one the game rolls, a new seat or a new zone. A kept system has none.
 */
export class OutcomesLayer implements MapLayer {
  readonly id = "outcomes" as const;
  readonly container = new Container();
  private readonly batches = new RingBatches(this.container, "outcome.");
  private galaxy = EMPTY_CONTEXT.galaxy;
  private systems: Systems = EMPTY_CONTEXT.systems;
  private outcomes: ReadonlyMap<number, Outcome> = new Map();
  private readonly scale = { x: 1, y: 1 };

  constructor(private readonly drawn: DrawnPositions) {}

  rebuild(ctx: RenderContext): void {
    const loaded = ctx.galaxy !== this.galaxy;
    this.galaxy = ctx.galaxy;
    this.systems = ctx.systems;
    if (loaded) this.place();
  }

  applyDelta(d: GalaxyDelta): void {
    const touched = [...d.systems.map((s) => s.id), ...(d.removed ?? [])];
    if (touched.some((id) => this.outcomes.has(id))) this.place();
  }

  setOutcome(outcomes: ReadonlyMap<number, Outcome>): void {
    this.outcomes = outcomes;
    this.place();
  }

  onViewport(cam: Camera): void {
    cam.childScale(markerScale(cam.scale), this.scale);
    this.batches.setScale(this.scale);
  }

  onDrawn({ moved }: DrawnChange): void {
    if (movedAny(moved, this.outcomes.keys())) this.place();
  }

  setVisible(v: boolean): void {
    this.container.visible = v;
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.batches.destroy();
  }

  private place(): void {
    const byOutcome = new Map<Outcome, number[]>();
    for (const [system, outcome] of this.outcomes) {
      const systems = byOutcome.get(outcome);
      if (systems === undefined) byOutcome.set(outcome, [system]);
      else systems.push(system);
    }
    const wanted = new Map<string, WantedRings>();
    for (const [outcome, systems] of byOutcome) {
      wanted.set(outcome, {
        spec: specOf(outcome),
        points: pointsOf(this.systems, systems, this.drawn.at),
      });
    }
    this.batches.sync(wanted);
  }
}
