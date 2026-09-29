import { describe, expect, it } from "vitest";
import { WORMHOLE_COLOR } from "../../../lib/visual/style";
import { systemContext } from "../context";
import { context, drawOps, SHROUD_TUNNEL, strokes, viewport, WORMHOLE } from "../fixture";
import { WormholesLayer } from "./WormholesLayer";

describe("the system scene's wormholes layer", () => {
  it("rings each wormhole at its point, a shroud tunnel dimmer, and none with Bypasses off", () => {
    const layer = new WormholesLayer();
    const ctx = context({});
    layer.rebuild(ctx);
    viewport(layer, 1);
    const rings = strokes(layer.marks);
    expect(rings.map((ring) => ring.color)).toEqual([WORMHOLE_COLOR, WORMHOLE_COLOR]);
    const [natural, tunnel] = rings;
    expect(tunnel.alpha).toBeLessThan(natural.alpha!);
    expect(ctx.wormholes.map((w) => [w.x, w.y])).toEqual([
      [WORMHOLE.x, WORMHOLE.y],
      [SHROUD_TUNNEL.x, SHROUD_TUNNEL.y],
    ]);
    expect(ctx.wormholes.map((w) => w.name)).toEqual(["Wormhole to S8", "Shroud Tunnel"]);

    layer.rebuild(systemContext({ ...ctx, sceneLayers: { ...ctx.sceneLayers, bypasses: false } }));
    expect(drawOps(layer.marks)).toEqual([]);
  });
});
