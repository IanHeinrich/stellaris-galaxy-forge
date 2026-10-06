import { Container } from "pixi.js";
import type { GalaxyDelta } from "../../generated/GalaxyDelta";
import type { Outcome } from "../../lib/prepareCopy";
import { OUTCOME_COLORS, OUTCOME_STROKE } from "../../lib/visual/outcomeColors";
import { RING_RADIUS } from "../../lib/visual/style";
import type { Camera } from "../Camera";
import { EMPTY_CONTEXT, type RenderContext, type Systems } from "../RenderContext";
import { DrawnPositions, movedAny, type DrawnChange } from "../drawnPositions";
import {
  pointsOf,
  RingBatches,
  type RingSpec,
  type WantedRings,
  ZoneMarks,
  zoneMarksOf,
} from "./highlights/RingBatch";
import { markerScale, type MapLayer } from "./MapLayer";

function specOf(outcome: Outcome): RingSpec {
  return {
    color: OUTCOME_COLORS[outcome],
    radius: RING_RADIUS.outcome,
    ...OUTCOME_STROKE,
  };
}

/**
 * A ring round every new starting position and new fallen empire zone the Prepare choices draw,
 * each in its own colour: a zone's round its own ring, not its anchor. Nothing else is marked.
 */
export class OutcomesLayer implements MapLayer {
  readonly id = "outcomes" as const;
  readonly container = new Container();
  private readonly batches = new RingBatches(this.container, "outcome.");
  private readonly zones = new ZoneMarks(specOf("zone"), "outcome.zones");
  private galaxy = EMPTY_CONTEXT.galaxy;
  private systems: Systems = EMPTY_CONTEXT.systems;
  private outcomes: ReadonlyMap<number, Outcome> = new Map();
  private readonly scale = { x: 1, y: 1 };

  constructor(private readonly drawn: DrawnPositions) {
    this.container.addChild(this.zones.graphics);
  }

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
    this.zones.setCamScale(cam.scale);
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
    const zoned = zoneMarksOf(this.systems, byOutcome.get("zone") ?? [], this.drawn.at);
    const wanted = new Map<string, WantedRings>();
    for (const [outcome, systems] of byOutcome) {
      const points =
        outcome === "zone" ? zoned.points : pointsOf(this.systems, systems, this.drawn.at);
      wanted.set(outcome, { spec: specOf(outcome), points });
    }
    this.batches.sync(wanted);
    this.zones.place(zoned.zones);
  }
}
