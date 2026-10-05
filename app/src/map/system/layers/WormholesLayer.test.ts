import type { Container, Sprite } from "pixi.js";
import { describe, expect, it } from "vitest";
import { systemContext } from "../context";
import { blankSceneTextures, context, SHROUD_TUNNEL, viewport, WORMHOLE } from "../drawFixture";
import { NO_HIGHLIGHT } from "./SystemLayer";
import { WormholesLayer } from "./WormholesLayer";

describe("the system scene's wormholes layer", () => {
  it("draws a vortex at each wormhole, a shroud tunnel dimmer, and none with Bypasses off", () => {
    const layer = new WormholesLayer(blankSceneTextures());
    const ctx = context({});
    layer.rebuild(ctx);
    viewport(layer, 1);
    const vortices = layer.container.children as Container[];
    expect(vortices.map((v) => [v.x, v.y])).toEqual([
      [WORMHOLE.x, WORMHOLE.y],
      [SHROUD_TUNNEL.x, SHROUD_TUNNEL.y],
    ]);
    const [natural, tunnel] = vortices;
    const layers = natural.children as Sprite[];
    expect(layers.map((l) => l.label)).toEqual(["haze", "swirl", "rim"]);
    expect(layers.every((l) => l.blendMode === "add")).toBe(true);
    expect(tunnel.alpha).toBeLessThan(natural.alpha);
    expect(ctx.wormholes.map((w) => w.name)).toEqual(["Wormhole to S8", "Shroud Tunnel"]);

    const plain = natural.scale.y;
    layer.setHighlighted({ ...NO_HIGHLIGHT, hover: { kind: "wormhole", id: WORMHOLE.id } });
    expect(natural.scale.y).toBeGreaterThan(plain);

    layer.rebuild(systemContext({ ...ctx, sceneLayers: { ...ctx.sceneLayers, bypasses: false } }));
    expect(layer.container.children).toEqual([]);
  });
});
