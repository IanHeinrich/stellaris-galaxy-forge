import type { MapInput, MapModel } from "./MapIntent";

/**
 * The Shape tool: a press on a handle drags it, inside the pending shape moves it, and elsewhere
 * draws a new one; the middle button pans.
 */
export class ShapeModel implements MapModel {
  // stub: W3 fills this; for now only the middle button does anything, and it pans
  private panning = false;

  handle(input: MapInput): "consumed" | "pan" {
    if (input.kind === "down" && input.button === 1) this.panning = true;
    else if (input.kind === "up" || input.kind === "cancel") this.panning = false;
    return input.kind === "move" && this.panning ? "pan" : "consumed";
  }

  cursor(): string {
    return this.panning ? "grabbing" : "crosshair";
  }

  busy(): boolean {
    return this.panning;
  }

  reset(): void {
    this.panning = false;
  }
}
