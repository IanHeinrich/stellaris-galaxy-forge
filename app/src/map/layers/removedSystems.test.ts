import { Texture, type Renderer } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { Issue } from "../../generated/Issue";
import { appIssue } from "../../test/builders";
import { IssuesLayer } from "./IssuesLayer";
import { SystemsLayer } from "./SystemsLayer";
import { mapContext, mapNode } from "./fixture";

const NODES = [mapNode(0, 0, "Sol"), mapNode(1, 20, "Alpha")];

const ISSUE: Issue = appIssue({
  severity: "warning",
  code: "lane_asymmetric",
  message: "Sol and Alpha disagree about the lane between them",
  systems: [0, 1],
});

const renderer = { generateTexture: () => Texture.EMPTY } as unknown as Renderer;

describe("a delta that removes a system", () => {
  it("takes its star with it", () => {
    const layer = new SystemsLayer(renderer);
    layer.rebuild(mapContext(NODES));
    expect(layer.container.children).toHaveLength(2);

    layer.rebuild(mapContext([NODES[0]]));
    layer.applyDelta({ systems: [], removed: [1] });
    expect(layer.container.children).toHaveLength(1);
  });

  it("takes its issue ring with it", () => {
    const layer = new IssuesLayer();
    layer.rebuild(mapContext(NODES));
    layer.setIssues([ISSUE]);
    expect(layer.container.children).toHaveLength(2);

    layer.rebuild(mapContext([NODES[0]]));
    layer.applyDelta({ systems: [], removed: [1] });
    expect(layer.container.children).toHaveLength(1);
  });
});

describe("a delta that removes most systems at once", () => {
  it("takes their stars and keeps the rest where they were", () => {
    const nodes = Array.from({ length: 40 }, (_, i) => mapNode(i, i * 10, `S${i}`));
    const layer = new SystemsLayer(renderer);
    layer.rebuild(mapContext(nodes));
    const kept = nodes.filter((n) => n.id % 4 === 0);
    layer.rebuild(mapContext(kept));
    const removed = nodes.filter((n) => n.id % 4 !== 0).map((n) => n.id);
    layer.applyDelta({ systems: [], removed });
    expect(layer.container.children.map((c) => c.x)).toEqual(kept.map((n) => n.x));
  });
});
