import { Container, Graphics } from "pixi.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/textures", () => ({ getTextures: () => Promise.resolve([]) }));
vi.mock("../../lib/visual/textures", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/visual/textures")>();
  return { ...actual, requestTextures: vi.fn(actual.requestTextures) };
});

import type { BypassLink } from "../../generated/BypassLink";
import type { BypassKinds } from "../../lib/details/icons";
import { requestTextures } from "../../lib/visual/textures";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { BypassesLayer } from "./BypassesLayer";
import {
  childByLabel,
  mapContext,
  stubTextMeasurement,
  mapNode,
  strokes,
  viewport,
} from "./fixture";

stubTextMeasurement();

const SYSTEMS = [mapNode(0, 0, "Sol"), mapNode(1, 40, "Alpha"), mapNode(2, 80, "Beta")];

function drawn(
  bypasses: readonly BypassLink[],
  scale = 1,
  bypassKinds?: BypassKinds,
): BypassesLayer {
  const layer = new BypassesLayer();
  layer.rebuild(mapContext(SYSTEMS, { bypasses, ...(bypassKinds && { bypassKinds }) }));
  viewport(layer, scale);
  return layer;
}

/** The badge roots the layer is drawing, each a container holding its plate and label. */
function badges(layer: BypassesLayer): Container[] {
  const badgeLayer = childByLabel(layer.container, "badges");
  if (!badgeLayer.visible) return [];
  return badgeLayer.children.filter((c): c is Container => c.visible);
}

function labels(layer: BypassesLayer): string[] {
  return badges(layer).map((root) => text(root).text);
}

function text(root: Container): { text: string } {
  const label = root.children.find((c) => "text" in c) as { text: string } | undefined;
  if (!label) throw new Error("badge has no label");
  return label;
}

/** The plate of the one badge on a star, as the pointer would find it. */
function plate(root: Container): Graphics {
  const graphics = root.children.filter((c): c is Graphics => c instanceof Graphics);
  const found = graphics.find((g) => g.eventMode === "static");
  if (!found) throw new Error("badge has no plate");
  return found;
}

/** Whether the plate sits above the star or below it. */
function side(root: Container): "above" | "below" {
  return plate(root).bounds.maxY < 0 ? "above" : "below";
}

function markers(layer: BypassesLayer): Graphics[] {
  const markerLayer = childByLabel(layer.container, "markers");
  if (!markerLayer.visible) return [];
  return markerLayer.children.filter((c): c is Graphics => c instanceof Graphics && c.visible);
}

beforeEach(() => {
  useMapChromeStore.setState({ ...useMapChromeStore.getInitialState() });
});

describe("the bypasses layer", () => {
  it("badges every gateway and L-Gate with what it is", () => {
    const layer = drawn([
      { type: "gateway", system: 0, active: true },
      { type: "gateway", system: 1, active: false },
      { type: "l_gate", system: 2 },
    ]);
    expect(labels(layer).sort()).toEqual(["Gateway", "L-Gate", "Ruined gateway"]);
  });

  it("draws a ruined gateway at full strength, told apart by its label alone", () => {
    const layer = drawn([
      { type: "gateway", system: 0, active: true },
      { type: "gateway", system: 1, active: false },
    ]);
    const [working, ruined] = badges(layer);
    expect(working.alpha).toBe(1);
    expect(ruined.alpha).toBe(1);
  });

  it("leaves the other bypass kinds their small markers and the wormhole pairs their lines", () => {
    const layer = drawn([
      { type: "other", system: 0, kind: "quantum_catapult" },
      { type: "wormhole", a: 1, b: 2 },
    ]);
    expect(badges(layer)).toEqual([]);
    expect(markers(layer)).toHaveLength(1);
    const lines = childByLabel(layer.container, "lines") as Graphics;
    expect(strokes(lines).length).toBeGreaterThan(0);
  });

  it("puts the badge on the side the point-of-interest badge leaves free", () => {
    const zoomedOut = drawn([
      { type: "gateway", system: 0, active: true },
      { type: "gateway", system: 1, active: true },
    ]);
    // `badgeSide` sends the odd ids below when zoomed out, so a bypass badge takes the other side.
    expect(badges(zoomedOut).map(side)).toEqual(["below", "above"]);

    const zoomedIn = drawn([{ type: "gateway", system: 0, active: true }], 10);
    zoomedIn.setDetailsShown(false);
    expect(badges(zoomedIn).map(side)).toEqual(["below"]);
  });

  it("stacks two badges on one star clear of each other", () => {
    const layer = drawn([
      { type: "gateway", system: 0, active: true },
      { type: "l_gate", system: 0 },
    ]);
    const [first, second] = badges(layer).map((root) => plate(root).bounds);
    expect(second.minY).toBeGreaterThanOrEqual(first.maxY);
  });

  it("keeps the badge when the details row shows and hands over only the small markers", () => {
    const layer = drawn(
      [
        { type: "gateway", system: 0, active: true },
        { type: "other", system: 1, kind: "shroud_tunnel" },
      ],
      10,
    );
    expect(badges(layer)).toHaveLength(1);
    expect(markers(layer)).toEqual([]);

    layer.setDetailsShown(false);
    expect(markers(layer)).toHaveLength(1);
  });

  it("keeps the badges when the map is zoomed out past the details row", () => {
    const layer = drawn([{ type: "gateway", system: 0, active: true }]);
    layer.setDetailsShown(true);
    expect(badges(layer)).toHaveLength(1);
  });

  it("names the bypass and its system while the pointer is on the badge", () => {
    const layer = drawn([{ type: "l_gate", system: 2 }]);
    const [badge] = badges(layer);

    plate(badge).emit("pointerover", { global: { x: 4, y: 6 } } as never);
    expect(useMapChromeStore.getState().tooltip).toMatchObject({
      title: "L-Gate",
      lines: ["Beta"],
    });

    plate(badge).emit("pointerout", {} as never);
    expect(useMapChromeStore.getState().tooltip).toBeNull();
  });

  it("names the marker's bypass kind and its system while the pointer is on it", () => {
    const layer = drawn([{ type: "other", system: 1, kind: "quantum_catapult" }]);
    const [marker] = markers(layer);

    marker.emit("pointerover", { global: { x: 4, y: 6 } } as never);
    expect(useMapChromeStore.getState().tooltip).toMatchObject({
      title: "Quantum Catapult",
      lines: ["Alpha"],
    });

    marker.emit("pointerout", {} as never);
    expect(useMapChromeStore.getState().tooltip).toBeNull();
  });

  it("tells apart a wormhole marker whose other end is not drawn", () => {
    const layer = drawn([{ type: "other", system: 0, kind: "wormhole" }]);
    const [marker] = markers(layer);

    marker.emit("pointerover", { global: { x: 4, y: 6 } } as never);
    expect(useMapChromeStore.getState().tooltip).toMatchObject({
      title: "Wormhole",
      lines: ["Its other end is not shown", "Sol"],
    });
  });

  it("wears a modded bypass kind's own icon frame instead of the built-in table's", () => {
    const kinds: BypassKinds = new Map([["gateway", { key: "gateway", icon_frame: 91 }]]);
    drawn([{ type: "gateway", system: 0, active: true }], 1, kinds);
    expect(vi.mocked(requestTextures).mock.calls.flat(2)).toContain(
      "sprite:GFX_ship_class_small#91",
    );
  });
});
