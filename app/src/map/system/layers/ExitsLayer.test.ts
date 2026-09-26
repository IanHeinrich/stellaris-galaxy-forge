import { describe, expect, it } from "vitest";
import { context, drawOps, viewport } from "../fixture";
import { ExitsLayer } from "./ExitsLayer";

describe("the system scene's exits layer", () => {
  it("draws one arrow per hyperlane, and none for a bypass", () => {
    const layer = new ExitsLayer();
    layer.rebuild(context({}));
    viewport(layer, 2);
    expect(drawOps(layer.arrows).filter((op) => op.action === "fill").length).toBe(2);
  });
});
