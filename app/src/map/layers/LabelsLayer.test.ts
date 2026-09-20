import { describe, expect, it } from "vitest";
import { DETAIL_SCALE } from "../../lib/visual/labels";
import { INITIALIZER_ALPHA } from "../../lib/visual/style";
import { LabelsLayer } from "./LabelsLayer";
import { drawnLabels, drawnText, mapContext, mapNode, viewport } from "./fixture";

const SOL = mapNode(0, 0, "Sol");
const DRAGON = mapNode(1, 20, "", "guardian_dragon");
const RANDOM = mapNode(2, 40, "");
const NODES = [SOL, DRAGON, RANDOM];

const CLOSE = DETAIL_SCALE + 1;
const FAR = DETAIL_SCALE - 1;

function labelled(over: Parameters<typeof mapContext>[1], scale = CLOSE): string[] {
  const layer = new LabelsLayer();
  layer.rebuild(mapContext(NODES, over));
  viewport(layer, scale);
  return drawnText(layer.container);
}

describe("one label per system", () => {
  it("names a system that has one and falls back to its initializer", () => {
    expect(labelled({ initializerLabels: true })).toEqual(["Sol", "guardian_dragon", "random"]);
  });

  it("leaves the unnamed systems bare while the initializers layer is off", () => {
    expect(labelled({ initializerLabels: false })).toEqual(["Sol"]);
  });

  it("fades an initializer label so the named systems stand out", () => {
    const layer = new LabelsLayer();
    layer.rebuild(mapContext(NODES, { initializerLabels: true }));
    viewport(layer, CLOSE);
    const alphas = new Map(drawnLabels(layer.container).map((l) => [l.text, l.alpha]));
    expect(alphas.get("Sol")).toBe(1);
    expect(alphas.get("guardian_dragon")).toBe(INITIALIZER_ALPHA);
    expect(alphas.get("random")).toBe(INITIALIZER_ALPHA);
  });
});

describe("the hidden-initializers filter", () => {
  it("drops the label of an unnamed system whose key it hides", () => {
    const hidden = { initializerLabels: true, hiddenInitializers: new Set(["guardian_dragon"]) };
    expect(labelled(hidden)).toEqual(["Sol", "random"]);
  });

  it("hides the random entry but never a named system that carries the same key", () => {
    const hidden = { initializerLabels: true, hiddenInitializers: new Set([""]) };
    expect(labelled(hidden)).toEqual(["Sol", "guardian_dragon"]);
  });
});

describe("zoomed out", () => {
  it("keeps a scenario's names and drops its initializer labels", () => {
    expect(labelled({ initializerLabels: true }, FAR)).toEqual(["Sol"]);
  });

  it("gives a scenario's names up to the territories once the empires layer draws them", () => {
    const territories = { initializerLabels: true, territoriesShown: true };
    expect(labelled(territories, FAR)).toEqual([]);
    expect(labelled(territories, CLOSE)).toEqual(["Sol", "guardian_dragon", "random"]);
  });

  it("relabels the moment the empires layer flips, without waiting for a zoom", () => {
    const layer = new LabelsLayer();
    layer.rebuild(mapContext(NODES, { initializerLabels: true }));
    viewport(layer, FAR);
    expect(drawnText(layer.container)).toEqual(["Sol"]);

    layer.rebuild(mapContext(NODES, { initializerLabels: true, territoriesShown: true }));
    viewport(layer, FAR);
    expect(drawnText(layer.container)).toEqual([]);

    layer.rebuild(mapContext(NODES, { initializerLabels: true, territoriesShown: false }));
    viewport(layer, FAR);
    expect(drawnText(layer.container)).toEqual(["Sol"]);
  });

  it("draws nothing for a save, as before", () => {
    expect(labelled({ kind: "save", initializerLabels: false }, FAR)).toEqual([]);
  });
});

describe("the label budget", () => {
  it("still labels the initializers when the names in view outnumber the cap", () => {
    const many = Array.from({ length: 450 }, (_, i) =>
      mapNode(i + 10, -99 + i * 0.4, `System ${i}`),
    );
    const layer = new LabelsLayer();
    layer.rebuild(mapContext([...many, DRAGON, RANDOM], { initializerLabels: true }));
    viewport(layer, CLOSE);
    const text = drawnText(layer.container);
    expect(text).toContain("guardian_dragon");
    expect(text).toContain("random");
    expect(text).toContain("System 449");
  });
});

describe("a deleted system", () => {
  it("takes its label with it", () => {
    const layer = new LabelsLayer();
    layer.rebuild(mapContext(NODES, { initializerLabels: true }));
    viewport(layer, CLOSE);
    layer.rebuild(mapContext([SOL, RANDOM], { initializerLabels: true }));
    layer.applyDelta({ systems: [], removed: [DRAGON.id] });
    expect(drawnText(layer.container)).toEqual(["Sol", "random"]);
  });
});
