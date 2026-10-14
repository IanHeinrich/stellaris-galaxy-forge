import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

const PREVIEW = vi.hoisted(() => ({
  current: null as null | {
    points: readonly { x: number; y: number }[];
    pairs: readonly [number, number][];
    left: readonly never[];
    outside: readonly never[];
    overlaps: number;
    capped: boolean;
    interleaved: number | null;
  },
}));
vi.mock("../../store/shapePreview", () => ({
  shapePreview: () => PREVIEW.current,
  useShapePreview: () => PREVIEW.current,
}));

import { SCENARIO_CAPABILITIES } from "../../lib/capabilities";
import { SHAPE_SPECS } from "../../lib/shapes/specs";
import type { Fill, PendingShape, ShapeKind } from "../../lib/shapes/types";
import { useEditorStore } from "../../store/editorStore";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useToolStore } from "../../store/toolStore";
import { ShapeOptions } from "./ShapeOptions";
import { ToolOptions } from "./ToolOptions";

const options = () => renderToStaticMarkup(<ShapeOptions />);

/** A pending shape of `kind` with `fill`, lanes as a new outline starts them. */
function pend(kind: ShapeKind, fill: Fill, over: Partial<PendingShape> = {}): PendingShape {
  return {
    shape: SHAPE_SPECS[kind].initial,
    fill,
    lanes: { follow: fill.kind === "outline", mode: "off" },
    skipNear: true,
    seed: 1,
    ...over,
  };
}

const OUTLINE: Fill = { kind: "outline", count: 24 };

beforeEach(() => {
  PREVIEW.current = null;
  useEditorStore.setState({ ...useEditorStore.getInitialState() });
  useFileSessionStore.setState({
    ...useFileSessionStore.getInitialState(),
    status: "ready",
    kind: "scenario",
    capabilities: SCENARIO_CAPABILITIES,
  });
  useToolStore.setState({ ...useToolStore.getInitialState(), tool: "shape" });
});

describe("the shape options", () => {
  it("say how to start while nothing is pending, and show what the next shape starts from", () => {
    const memory = useToolStore.getState().shapeMemory;
    useToolStore.setState({
      shapeMemory: {
        ...memory,
        kind: "star",
        kinds: {
          ...memory.kinds,
          star: {
            shape: SHAPE_SPECS.star.initial,
            fill: { kind: "grid", spacing: 30, lattice: "square" },
            lanes: { follow: false, mode: "new" },
          },
        },
        skipNear: false,
      },
    });
    const html = options();
    expect(html).toContain("Drag on the map to draw a shape");
    expect(html).toMatch(/aria-checked="true" title="Star"/);
    expect(html).toMatch(/aria-checked="true">Grid</);
    expect(html).toMatch(/aria-checked="true">Square</);
    expect(html).toContain("Points");
    expect(html).toContain("Inner radius");
    expect(html).toContain("Spacing");
    expect(html).toContain('<option value="new" selected="">Among new</option>');
    expect(html).not.toMatch(/checked=""[^>]*\/>Don&#x27;t place/);
    for (const absent of [">Place", "Size presets", "Shuffle", "Exact values"]) {
      expect(html).not.toContain(absent);
    }
  });

  it("are the Shape tool's row of ToolOptions", () => {
    useToolStore.setState({ pendingShape: pend("circle", OUTLINE) });
    expect(renderToStaticMarkup(<ToolOptions />)).toContain("Follow the shape");
  });

  it("offer every kind of shape in the picker, the pending one checked", () => {
    useToolStore.setState({ pendingShape: pend("polygon", OUTLINE) });
    const html = options();
    for (const label of ["Line", "Circle", "Polygon", "Rectangle", "Star"]) {
      expect(html).toContain(`title="${label}"`);
    }
    expect(html).toMatch(/aria-checked="true" title="Polygon"/);
    expect(html).toMatch(/aria-checked="false" title="Circle"/);
  });

  it("show Systems for an outline and Spacing for a fill", () => {
    useToolStore.setState({ pendingShape: pend("circle", OUTLINE) });
    const outline = options();
    expect(outline).toContain("Systems");
    expect(outline).toMatch(/min="2" max="1000"[^>]*aria-label="Systems along the outline"/);
    expect(outline).not.toContain("Spacing");

    useToolStore.setState({ pendingShape: pend("circle", { kind: "scattered", spacing: 25 }) });
    const scattered = options();
    expect(scattered).toContain("Spacing");
    expect(scattered).not.toContain("Systems");
  });

  it("show Square and Hex only for a grid, and Shuffle only for a scattered fill", () => {
    useToolStore.setState({ pendingShape: pend("rect", OUTLINE) });
    expect(options()).not.toContain("Square");
    expect(options()).not.toContain("Shuffle");

    useToolStore.setState({ pendingShape: pend("rect", { kind: "scattered", spacing: 25 }) });
    expect(options()).not.toContain("Hex");
    expect(options()).toContain("Shuffle");

    useToolStore.setState({
      pendingShape: pend("rect", { kind: "grid", spacing: 25, lattice: "hex" }),
    });
    const grid = options();
    expect(grid).toMatch(/aria-checked="false">Square<.*aria-checked="true">Hex</);
    expect(grid).not.toContain("Shuffle");
  });

  it("offer a line and an arc only the outline", () => {
    useToolStore.setState({ pendingShape: pend("line", OUTLINE) });
    const html = options();
    expect(html).toContain(">Outline<");
    expect(html).not.toContain(">Scattered<");
    expect(html).not.toContain(">Grid<");
  });

  it("tick Follow the shape for an outline and leave it off for a fill", () => {
    useToolStore.setState({ pendingShape: pend("circle", OUTLINE) });
    expect(options()).toMatch(/checked=""[^>]*\/>Follow the shape/);

    useToolStore.setState({ pendingShape: pend("circle", { kind: "scattered", spacing: 25 }) });
    expect(options()).toMatch(/<input type="checkbox"(?![^>]*checked)[^>]*\/>Follow the shape/);
  });

  it("show Lane density only while Lanes is not off", () => {
    useToolStore.setState({ pendingShape: pend("circle", OUTLINE) });
    expect(options()).not.toContain("Lane density");

    useToolStore.setState({
      pendingShape: pend("circle", OUTLINE, { lanes: { follow: true, mode: "new" } }),
    });
    const html = options();
    expect(html).toContain('<option value="new" selected="">Among new</option>');
    expect(html).toContain("Lane density");
  });

  it("show the shape's own Lanes choice, not the paint brush's", () => {
    useToolStore.setState({
      pendingShape: pend("circle", OUTLINE, { lanes: { follow: true, mode: "new" } }),
      laneMode: "nearby",
    });
    const html = options();
    expect(html).toContain('<option value="new" selected="">Among new</option>');
    expect(html).not.toContain('<option value="nearby" selected="">');
  });

  it("tick the rule against placing on top of existing systems, and fold the exact values", () => {
    useToolStore.setState({ pendingShape: pend("circle", OUTLINE) });
    const html = options();
    expect(html).toMatch(/checked=""[^>]*\/>Don&#x27;t place on top of existing systems/);
    expect(html).toContain("<details");
    expect(html).toContain("<summary>Exact values</summary>");
    expect(html).toContain('aria-label="Centre x in game units"');

    useToolStore.setState({ pendingShape: pend("circle", OUTLINE, { skipNear: false }) });
    expect(options()).not.toMatch(/checked=""[^>]*\/>Don&#x27;t/);
  });

  it("label the Place button with what the preview adds, and disable it with nothing to add", () => {
    useToolStore.setState({ pendingShape: pend("circle", OUTLINE) });
    expect(options()).toMatch(/<button[^>]* disabled=""[^>]*>Place</);

    PREVIEW.current = {
      points: Array.from({ length: 24 }, (_, i) => ({ x: i, y: 0 })),
      pairs: [],
      left: [],
      outside: [],
      overlaps: 0,
      capped: false,
      interleaved: null,
    };
    const html = options();
    expect(html).toContain(">Place 24 systems<");
    expect(html).not.toMatch(/<button[^>]* disabled=""[^>]*>Place 24/);
  });
});
