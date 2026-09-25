import { Graphics } from "pixi.js";
import { describe, expect, it } from "vitest";
import { nextColour, type WatchRings } from "../../lib/watchlist";
import { WatchlistLayer } from "./WatchlistLayer";
import { mapContext, mapNode, strokes, viewport } from "./fixture";

/** Every ring the layer shows, whichever batch holds it. */
function shownRings(layer: WatchlistLayer): Graphics[] {
  return layer.container.children.flatMap((batch) =>
    batch.children.filter((ring): ring is Graphics => ring instanceof Graphics && ring.visible),
  );
}

describe("the watchlist layer", () => {
  it("rings every shown entry's systems, however many entries share a colour", () => {
    const nodes = Array.from({ length: 7 }, (_, i) => mapNode(i, i * 10, `S${i}`));
    const colours = nodes.reduce<number[]>((taken) => [...taken, nextColour(taken)], []);
    const entries: WatchRings[] = colours.map((colour, slot) => ({
      colour,
      slot,
      systems: [slot],
    }));
    const layer = new WatchlistLayer();
    layer.rebuild(mapContext(nodes));
    viewport(layer, 1);
    layer.setWatchlist(entries);

    const rings = shownRings(layer);
    for (const entry of entries) {
      const ring = rings.find((g) => g.x === nodes[entry.slot].x);
      expect(ring, `entry ${entry.slot}`).toBeDefined();
      expect(strokes(ring!)[0].color).toBe(entry.colour);
    }
  });
});
