import { Graphics } from "pixi.js";
import { beforeEach, describe, expect, it } from "vitest";
import type { FeZone } from "../../generated/FeZone";
import type { SystemNode } from "../../generated/SystemNode";
import { newFeZone } from "../../lib/feZone";
import { GHOST_ALPHA } from "../../lib/visual/style";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { AUTOMATIC_NOTE, FeZonesLayer } from "./FeZonesLayer";
import { childByLabel, drawOps, drawnText, mapContext, mapNode, viewport } from "./fixture";

/** An anchor at `x` whose ring lies east at 40: centred at (x - 40, 0) unless `over` says otherwise. */
function anchored(id: number, x: number, over: Partial<FeZone> = {}): SystemNode {
  return { ...mapNode(id, x, `S${id}`), fe_zone: { ...newFeZone("e"), ...over } };
}

const ZONED = anchored(0, 0);
const PLAIN = mapNode(1, 200, "S1");

function rings(layer: FeZonesLayer): Graphics[] {
  return layer.container.children
    .filter((child): child is Graphics => child instanceof Graphics && child.visible)
    .sort((a, b) => a.x - b.x);
}

function ringAt(layer: FeZonesLayer, x: number): Graphics {
  const ring = rings(layer).find((g) => Math.abs(g.x - x) < 1e-6);
  if (!ring) throw new Error(`no ring at ${x}`);
  return ring;
}

function fills(ring: Graphics): number {
  return drawOps(ring).filter((op) => op.action === "fill").length;
}

function drawn(nodes: readonly SystemNode[], paintLayer = true): FeZonesLayer {
  const layer = new FeZonesLayer();
  layer.rebuild(mapContext(nodes, { paintLayer }));
  viewport(layer, 1);
  return layer;
}

beforeEach(() => {
  useMapChromeStore.setState({ ...useMapChromeStore.getInitialState() });
});

describe("the fallen empire zones layer", () => {
  it("draws a ring at each zone's centre and nothing for a system that anchors none", () => {
    const layer = drawn([ZONED, PLAIN]);
    expect(rings(layer).map((g) => [g.x, g.y])).toEqual([[-40, 0]]);
  });

  it("draws nothing for a save, or for a scenario not written for the mod", () => {
    expect(rings(drawn([ZONED], false))).toEqual([]);
    const layer = new FeZonesLayer();
    layer.rebuild(mapContext([ZONED], { kind: "save", paintLayer: true }));
    expect(rings(layer)).toEqual([]);
  });

  it("follows a delta that adds, moves and removes a zone", () => {
    const layer = drawn([ZONED, PLAIN]);
    layer.applyDelta({ systems: [anchored(1, 200, { direction: "n", distance: 60 })] });
    expect(rings(layer).map((g) => [g.x, g.y])).toEqual([
      [-40, 0],
      [200, -60],
    ]);
    layer.applyDelta({ systems: [{ ...ZONED, fe_zone: null }] });
    expect(rings(layer).map((g) => [g.x, g.y])).toEqual([[200, -60]]);
    layer.applyDelta({ systems: [], removed: [1] });
    expect(rings(layer)).toEqual([]);
  });

  it("draws a placed zone in full and an automatic one as a ghost", () => {
    const layer = drawn([ZONED, anchored(1, 200, { preferred: false })]);
    expect(ringAt(layer, -40).alpha).toBe(1);
    expect(ringAt(layer, 160).alpha).toBe(GHOST_ALPHA);
  });

  it("writes the kind's tag at the centre, and nothing for a random one", () => {
    const layer = drawn([ZONED, anchored(1, 200, { kind: "materialist" })]);
    const tags = childByLabel(layer.container, "tags");
    expect(drawnText(tags)).toEqual(["Mat"]);
    layer.applyDelta({ systems: [anchored(1, 200, { kind: "hive" })] });
    expect(drawnText(tags)).toEqual(["Hive"]);
    layer.applyDelta({ systems: [anchored(1, 200)] });
    expect(drawnText(tags)).toEqual([]);
  });

  it("fills the ring whose anchor is selected", () => {
    const layer = drawn([ZONED]);
    expect(fills(ringAt(layer, -40))).toBe(0);
    layer.setSelection([0]);
    expect(fills(ringAt(layer, -40))).toBe(1);
    layer.setSelection([]);
    expect(fills(ringAt(layer, -40))).toBe(0);
  });

  it("moves the ring with its anchor's ghost while it is dragged, and back when the drag ends", () => {
    const layer = drawn([ZONED]);
    const ghost = { id: 0, x: 100, y: 50 };
    layer.setDragState({ ghosts: [ghost], byId: new Map([[0, ghost]]) });
    expect(rings(layer).map((g) => [g.x, g.y, g.alpha])).toEqual([[60, 50, GHOST_ALPHA]]);
    layer.setDragState(null);
    expect(rings(layer).map((g) => [g.x, g.y, g.alpha])).toEqual([[-40, 0, 1]]);
  });

  it("answers the pointer on the band and not inside the disc", () => {
    const ring = ringAt(drawn([ZONED]), -40);
    expect(ring.hitArea?.contains(30, 0)).toBe(true);
    expect(ring.hitArea?.contains(0, 0)).toBe(false);
    expect(ring.hitArea?.contains(20, 0)).toBe(false);
  });

  it("says what the ring is, whose it is and what the mod does there while the pointer is on it", () => {
    const layer = drawn([
      anchored(0, 0, { kind: "xenophile" }),
      anchored(1, 200, { preferred: false }),
    ]);
    ringAt(layer, -40).emit("pointerover", { global: { x: 4, y: 6 } } as never);
    expect(useMapChromeStore.getState().tooltip).toMatchObject({
      title: "Fallen empire zone",
      lines: ["Xenophile · S0 · the mod creates the empire's systems here"],
    });
    ringAt(layer, -40).emit("pointerout", {} as never);
    expect(useMapChromeStore.getState().tooltip).toBeNull();

    ringAt(layer, 160).emit("pointerover", { global: { x: 4, y: 6 } } as never);
    expect(useMapChromeStore.getState().tooltip).toMatchObject({
      lines: [`Random · S1 · the mod creates the empire's systems here · ${AUTOMATIC_NOTE}`],
    });
  });
});
