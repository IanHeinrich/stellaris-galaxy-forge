import { Graphics } from "pixi.js";
import { beforeEach, describe, expect, it } from "vitest";
import type { Issue } from "../../generated/Issue";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { IssuesLayer, SEVERITY_COLOR } from "./IssuesLayer";
import { mapContext, mapNode, strokes, viewport } from "./fixture";

const SOL = mapNode(0, 0, "Sol");

const ISOLATED: Issue = {
  severity: "error",
  code: "system_isolated",
  message: "Sol has no hyperlanes",
  systems: [0],
  note: false,
};

/** The ring drawn on the system at `x`, as the pointer would find it. */
function ringAt(layer: IssuesLayer, x: number): Graphics {
  const ring = layer.container.children.find(
    (child): child is Graphics => child instanceof Graphics && child.x === x,
  );
  if (!ring) throw new Error(`no ring at ${x}`);
  return ring;
}

beforeEach(() => {
  useMapChromeStore.setState({ ...useMapChromeStore.getInitialState() });
});

describe("the issues layer", () => {
  it("names the issue's severity, what it is and why it matters, on the ring", () => {
    const layer = new IssuesLayer();
    layer.rebuild(mapContext([SOL]));
    viewport(layer, 1);
    layer.setIssues([ISOLATED]);
    const ring = ringAt(layer, SOL.x);

    ring.emit("pointerover", { global: { x: 4, y: 6 } } as never);
    expect(useMapChromeStore.getState().tooltip).toMatchObject({
      title: "Error",
      lines: [
        "System with no hyperlanes",
        "Nothing links this system to the rest of the galaxy. Only a gate or a jump drive can reach it.",
      ],
    });

    ring.emit("pointerout", {} as never);
    expect(useMapChromeStore.getState().tooltip).toBeNull();
  });

  it("rings a system in the colour of its worst issue, whatever order they come in", () => {
    const layer = new IssuesLayer();
    layer.rebuild(mapContext([SOL]));
    viewport(layer, 1);
    const duplicate: Issue = { ...ISOLATED, severity: "info", code: "lane_duplicate" };
    const outside: Issue = { ...ISOLATED, severity: "warning", code: "out_of_bounds" };
    layer.setIssues([duplicate, outside]);

    expect(strokes(ringAt(layer, SOL.x))[0].color).toBe(SEVERITY_COLOR.warning);
  });
});
