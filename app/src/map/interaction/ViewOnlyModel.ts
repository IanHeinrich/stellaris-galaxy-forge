import type { MapInput, MapModel } from "./MapIntent";

/** The tilted map's model: a drag with any button pans, and nothing is picked, selected or edited. */
export class ViewOnlyModel implements MapModel {
  private panning = false;

  handle(input: MapInput): "consumed" | "pan" {
    switch (input.kind) {
      case "down":
        this.panning = true;
        return "consumed";
      case "move":
        return this.panning ? "pan" : "consumed";
      case "up":
      case "cancel":
        this.panning = false;
        return "consumed";
    }
  }

  cursor(): string {
    return this.panning ? "grabbing" : "grab";
  }

  busy(): boolean {
    return this.panning;
  }

  reset(): void {
    this.panning = false;
  }
}
