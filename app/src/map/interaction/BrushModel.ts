import { BRUSH_TOOLS, type BrushTool, type EraseTarget } from "../../lib/brush/brushTools";
import type { MapInput, MapIntent, MapModel } from "./MapIntent";

/**
 * A brush (ADR 0005): the left button lays one stroke from press to release, the middle button
 * pans, and a bare pointer carries the brush circle. `Alt` held at the press inverts the stroke.
 */
export class BrushModel implements MapModel {
  private stroke: BrushTool | null = null;
  private panning = false;

  /** `eraseTarget` is read at each input, since what Alt inverts Erase into follows it. */
  constructor(
    private readonly tool: BrushTool,
    private readonly eraseTarget: () => EraseTarget = () => "systems",
  ) {}

  handle(input: MapInput, intent: MapIntent): "consumed" | "pan" {
    switch (input.kind) {
      case "down":
        this.down(input, intent);
        return "consumed";
      case "move":
        if (this.panning) return "pan";
        if (this.stroke) intent.extendStroke(input.wx, input.wy);
        else intent.hoverBrush(this.toolAt(input), input.wx, input.wy);
        return "consumed";
      case "up":
        this.up(input, intent);
        return "consumed";
      case "cancel":
        this.reset(intent);
        return "consumed";
    }
  }

  cursor(): string {
    return this.panning ? "grabbing" : "crosshair";
  }

  busy(): boolean {
    return this.stroke !== null || this.panning;
  }

  reset(intent: MapIntent): void {
    if (this.stroke) intent.cancelStroke();
    this.stroke = null;
    this.panning = false;
    intent.endBrush();
  }

  private toolAt(input: MapInput): BrushTool {
    return input.alt ? BRUSH_TOOLS[this.tool].inverse(this.eraseTarget()) : this.tool;
  }

  private down(input: MapInput, intent: MapIntent): void {
    if (this.busy()) return;
    if (input.button === 0) {
      this.stroke = this.toolAt(input);
      intent.beginStroke(this.stroke, input.wx, input.wy);
    } else if (input.button === 1) {
      this.panning = true;
      intent.endBrush();
    }
  }

  private up(input: MapInput, intent: MapIntent): void {
    if (input.button === 1 && this.panning) {
      this.panning = false;
    } else if (input.button === 0 && this.stroke) {
      this.stroke = null;
      intent.commitStroke();
    } else {
      return;
    }
    intent.hoverBrush(this.toolAt(input), input.wx, input.wy);
  }
}
