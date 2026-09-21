import { BitmapText, Graphics } from "pixi.js";
import { beforeEach, describe, expect, it } from "vitest";
import type { FeZone } from "../../generated/FeZone";
import type { SystemNode } from "../../generated/SystemNode";
import { newFeZone } from "../../lib/feZone";
import { GHOST_ALPHA } from "../../lib/visual/style";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { AUTOMATIC_NOTE, FeZonesLayer } from "./FeZonesLayer";
import { childByLabel, drawOps, mapContext, mapNode, viewport } from "./fixture";

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

function tagAt(layer: FeZonesLayer, x: number): BitmapText {
  const tags = childByLabel(layer.container, "tags");
  const tag = tags.children.find(
    (c): c is BitmapText => c instanceof BitmapText && Math.abs(c.x - x) < 1e-6,
  );
  if (!tag) throw new Error(`no tag at ${x}`);
  return tag;
}

function spawnGhostsAt(layer: FeZonesLayer, x: number): Graphics {
  const ghosts = childByLabel(layer.container, "spawnGhosts");
  const g = ghosts.children.find(
    (c): c is Graphics => c instanceof Graphics && Math.abs(c.x - x) < 1e-6,
  );
  if (!g) throw new Error(`no spawn ghosts at ${x}`);
  return g;
}

function linksAt(layer: FeZonesLayer, x: number): Graphics | undefined {
  const links = childByLabel(layer.container, "links");
  return links.children.find(
    (c): c is Graphics => c instanceof Graphics && c.visible && Math.abs(c.x - x) < 1e-6,
  );
}

/** Every dash of the links about their centre, as `[fromX, fromY, toX, toY]`. */
function dashes(links: Graphics | undefined): number[][] {
  if (!links) return [];
  return drawOps(links).flatMap((op) => op.segments);
}

/** An anchor whose zone takes custom connections under `id`. */
function taking(id: number, node: SystemNode): SystemNode {
  return { ...node, fe_link: { custom: true, id, to: [] } };
}

/** A system linked to the id `to`. */
function linked(node: SystemNode, ...to: number[]): SystemNode {
  return { ...node, fe_link: { custom: false, id: null, to } };
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

  it("writes 'Fallen empire zone' at every ring's centre, with the kind's label below unless it is random", () => {
    const layer = drawn([ZONED, anchored(1, 200, { kind: "materialist" })]);
    expect(tagAt(layer, -40).text).toBe("Fallen empire zone");
    expect(tagAt(layer, 160).text).toBe("Fallen empire zone\nMaterialist");

    layer.applyDelta({ systems: [anchored(1, 200, { kind: "hive" })] });
    expect(tagAt(layer, 160).text).toBe("Fallen empire zone\nHive");

    layer.applyDelta({ systems: [anchored(1, 200)] });
    expect(tagAt(layer, 160).text).toBe("Fallen empire zone");
  });

  it("draws a stable scatter of spawn ghosts, seeded by the anchor id", () => {
    const first = drawn([ZONED]);
    const again = drawn([ZONED]);
    const other = drawn([anchored(7, 0)]);

    const firstOps = drawOps(spawnGhostsAt(first, -40));
    expect(firstOps.length).toBeGreaterThan(0);
    expect(drawOps(spawnGhostsAt(again, -40))).toEqual(firstOps);
    expect(drawOps(spawnGhostsAt(other, -40))).not.toEqual(firstOps);
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

  it("draws a dashed line from each linked system to the nearest point of its zone's ring, in the ring's colour", () => {
    // S2 stands at the ring's centre, which the core never allows, so it gets no line.
    const layer = drawn([taking(2, ZONED), linked(PLAIN, 2), linked(mapNode(2, -40, "S2"), 2)]);
    const links = linksAt(layer, -40)!;
    const ops = drawOps(links);
    expect(ops.map((op) => [op.action, op.color, op.alpha])).toEqual([["stroke", 0xf0abfc, 0.75]]);
    const segments = dashes(links);
    expect(segments[0].slice(0, 2)).toEqual([30, 0]);
    const last = segments[segments.length - 1];
    expect(last[2]).toBeCloseTo(240);
    expect(last[3]).toBe(0);
    expect(segments.length).toBeGreaterThan(20);
    for (const [ax, ay, bx, by] of segments) {
      expect(ay).toBe(0);
      expect(by).toBe(0);
      expect(bx).toBeGreaterThan(ax);
    }
    expect(links.alpha).toBe(1);
  });

  it("draws no line for a zone that links by the mod's rule, or takes custom connections from nobody", () => {
    expect(linksAt(drawn([ZONED, linked(PLAIN, 2)]), -40)).toBeUndefined();
    expect(linksAt(drawn([taking(2, ZONED), PLAIN]), -40)).toBeUndefined();
    expect(linksAt(drawn([taking(2, ZONED), linked(PLAIN, 3)]), -40)).toBeUndefined();
  });

  it("draws the lines of an automatic zone as a ghost, like its ring", () => {
    const layer = drawn([taking(2, anchored(0, 0, { preferred: false })), linked(PLAIN, 2)]);
    expect(linksAt(layer, -40)!.alpha).toBe(GHOST_ALPHA);
  });

  it("follows a delta that links, moves, unlinks and drops a linked system", () => {
    const layer = drawn([taking(2, ZONED), PLAIN]);
    expect(linksAt(layer, -40)).toBeUndefined();

    layer.applyDelta({ systems: [linked(PLAIN, 2)] });
    expect(dashes(linksAt(layer, -40)).pop()![2]).toBeCloseTo(240);

    layer.applyDelta({ systems: [{ ...linked(PLAIN, 2), x: 100 }] });
    expect(dashes(linksAt(layer, -40)).pop()![2]).toBeCloseTo(140);

    layer.applyDelta({ systems: [PLAIN] });
    expect(linksAt(layer, -40)).toBeUndefined();

    layer.applyDelta({ systems: [linked(PLAIN, 2)] });
    layer.applyDelta({ systems: [], removed: [1] });
    expect(linksAt(layer, -40)).toBeUndefined();
  });

  it("takes the lines away when the zone goes back to the mod's rule, and moves them with the ring", () => {
    const layer = drawn([taking(2, ZONED), linked(PLAIN, 2)]);
    layer.applyDelta({ systems: [taking(2, anchored(0, 0, { direction: "n" }))] });
    expect(linksAt(layer, -40)).toBeUndefined();
    const moved = linksAt(layer, 0)!;
    expect([moved.x, moved.y]).toEqual([0, -40]);
    expect(
      dashes(moved)[0]
        .slice(0, 2)
        .map((v) => Math.round(v)),
    ).toEqual([29, 6]);

    layer.applyDelta({ systems: [ZONED] });
    expect(linksAt(layer, -40)).toBeUndefined();
    expect(linksAt(layer, 0)).toBeUndefined();
  });

  it("moves a line's end with the linked system's ghost while it is dragged", () => {
    const layer = drawn([taking(2, ZONED), linked(PLAIN, 2)]);
    const ghost = { id: 1, x: 100, y: 0 };
    layer.setDragState({ ghosts: [ghost], byId: new Map([[1, ghost]]) });
    expect(dashes(linksAt(layer, -40)).pop()![2]).toBeCloseTo(140);
    layer.setDragState(null);
    expect(dashes(linksAt(layer, -40)).pop()![2]).toBeCloseTo(240);
  });
});
