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
    crowded: number;
    capped: boolean;
    interleaved: number | null;
    classes: readonly string[] | null;
  },
}));
vi.mock("../../store/shapePreview", async (actual) => ({
  ...(await actual<object>()),
  shapePreview: () => PREVIEW.current,
  useShapePreview: () => PREVIEW.current,
}));

import { SAVE_CAPABILITIES, SCENARIO_CAPABILITIES } from "../../lib/capabilities";
import { NO_EXTRAS } from "../../lib/shapes/extras";
import { SHAPE_SPECS } from "../../lib/shapes/specs";
import type { Fill, PendingShape, ShapeKind } from "../../lib/shapes/types";
import { useEditorStore } from "../../store/editorStore";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useGeneratorStore } from "../../store/generatorStore";
import { useToolStore } from "../../store/toolStore";
import { ShapeOptions } from "./ShapeOptions";
import { ToolOptions } from "./ToolOptions";

const options = () => renderToStaticMarkup(<ShapeOptions />);

/** A pending shape of `kind` with `fill`, lanes as a new outline starts them. */
function pend(kind: ShapeKind, fill: Fill, over: Partial<PendingShape> = {}): PendingShape {
  return {
    purpose: { kind: "add" },
    shape: SHAPE_SPECS[kind].initial,
    fill,
    lanes: { follow: fill.kind === "outline", mode: "off" },
    extras: NO_EXTRAS,
    skipNear: true,
    stars: { kind: "random" },
    seed: 1,
    ...over,
  };
}

const OUTLINE: Fill = { kind: "outline", count: 24 };

/** The generator's star classes, as a save with game data reads them. */
const STAR_CLASSES = [
  { key: "sc_g", label: "G · yellow", odds: 10, randomOdds: 10 },
  { key: "sc_m", label: "M · red dwarf", odds: 20, randomOdds: 20 },
  { key: "sc_pulsar", label: "Pulsar", odds: 1, randomOdds: 0 },
];

/** A preview of `n` points along a line, `classes` rolled for them. */
function preview(n: number, classes: readonly string[] | null = null) {
  return {
    points: Array.from({ length: n }, (_, i) => ({ x: i, y: 0 })),
    pairs: [],
    left: [],
    outside: [],
    overlaps: 0,
    crowded: 0,
    capped: false,
    interleaved: null,
    classes,
  };
}

/** The options over a 4.x save. */
function onSave(): void {
  useFileSessionStore.setState({ kind: "save", capabilities: SAVE_CAPABILITIES });
}

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
            extras: NO_EXTRAS,
          },
        },
        skipNear: false,
      },
    });
    const html = options();
    expect(html).toContain("Drag on the map to draw a shape");
    expect(html).toMatch(/aria-checked="true" title="Star"/);
    expect(html).toMatch(/aria-checked="true">Square grid</);
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

    useToolStore.setState({
      pendingShape: pend("circle", { kind: "scattered", spacing: 25, edge: true }),
    });
    const scattered = options();
    expect(scattered).toContain("Spacing");
    expect(scattered).not.toContain("Systems");
  });

  it("offer the four fills in one row, and Shuffle only for a scattered fill", () => {
    useToolStore.setState({ pendingShape: pend("circle", OUTLINE) });
    const outline = options();
    const row = /aria-label="Fill">(.*?)<\/div>/.exec(outline)![1];
    expect([...row.matchAll(/>([^<]+)<\/button>/g)].map((m) => m[1])).toEqual([
      "Outline",
      "Scattered",
      "Square grid",
      "Hex grid",
    ]);
    expect(outline).toMatch(/aria-checked="true">Outline</);
    expect(outline.match(/role="radiogroup"/g)).toHaveLength(2);
    expect(outline).not.toContain("Shuffle");

    useToolStore.setState({
      pendingShape: pend("rect", { kind: "scattered", spacing: 25, edge: true }),
    });
    expect(options()).toMatch(/aria-checked="true">Scattered</);
    expect(options()).toContain("Shuffle");

    useToolStore.setState({
      pendingShape: pend("rect", { kind: "grid", spacing: 25, lattice: "hex" }),
    });
    const grid = options();
    expect(grid).toMatch(/aria-checked="false">Square grid<.*aria-checked="true">Hex grid</);
    expect(grid).not.toContain("Shuffle");
  });

  it("offer a line only the outline, and an arc every fill", () => {
    useToolStore.setState({ pendingShape: pend("line", OUTLINE) });
    const line = options();
    expect(line).toContain(">Outline<");
    for (const absent of [">Scattered<", ">Square grid<", ">Hex grid<"]) {
      expect(line).not.toContain(absent);
    }

    useToolStore.setState({
      pendingShape: pend("circle", OUTLINE, {
        shape: { ...SHAPE_SPECS.circle.initial, sweep: 180 },
      }),
    });
    const arc = options();
    for (const label of [">Outline<", ">Scattered<", ">Square grid<", ">Hex grid<"]) {
      expect(arc).toContain(label);
    }
  });

  it("offer the edge row for a scattered fill, and Follow the shape only while there is one", () => {
    useToolStore.setState({ pendingShape: pend("circle", OUTLINE) });
    expect(options()).not.toContain("Line the edge with systems");

    useToolStore.setState({
      pendingShape: pend("circle", { kind: "scattered", spacing: 25, edge: true }),
    });
    const lined = options();
    expect(lined).toMatch(/checked=""[^>]*\/>Line the edge with systems/);
    expect(lined).toContain("Follow the shape");

    useToolStore.setState({
      pendingShape: pend("circle", { kind: "scattered", spacing: 25, edge: false }),
    });
    const bare = options();
    expect(bare).toMatch(
      /<input type="checkbox"(?![^>]*checked)[^>]*\/>Line the edge with systems/,
    );
    expect(bare).not.toContain("Follow the shape");

    useToolStore.setState({
      pendingShape: pend("circle", { kind: "grid", spacing: 25, lattice: "square" }),
    });
    expect(options()).not.toContain("Follow the shape");
  });

  it("start Spacing at the closest spacing that fills the whole shape, and show the one used", () => {
    useToolStore.setState({
      pendingShape: pend(
        "circle",
        { kind: "grid", spacing: 5, lattice: "square" },
        { shape: { ...SHAPE_SPECS.circle.initial, radius: 500 } },
      ),
    });
    const field =
      /min="([\d.]+)" max="150" step="0.1" aria-label="Spacing between[^"]*" value="([\d.]+)"/.exec(
        options(),
      );
    expect(Number(field![1])).toBeGreaterThan(5);
    expect(Number(field![2])).toBe(Number(field![1]));
    expect(useToolStore.getState().pendingShape!.fill).toMatchObject({ spacing: 5 });
  });

  it("tick Follow the shape for an outline and leave it off for a fill", () => {
    useToolStore.setState({ pendingShape: pend("circle", OUTLINE) });
    expect(options()).toMatch(/checked=""[^>]*\/>Follow the shape/);

    useToolStore.setState({
      pendingShape: pend("circle", { kind: "scattered", spacing: 25, edge: true }),
    });
    expect(options()).toMatch(/<input type="checkbox"(?![^>]*checked)[^>]*\/>Follow the shape/);
  });

  it("show each extra only where it changes the shape, and spokes once there is a centre system", () => {
    useToolStore.setState({ pendingShape: pend("circle", OUTLINE) });
    let html = options();
    for (const label of ["Band", "Rings", "Wobble", "Gaps"]) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    expect(html).toContain("A system at the centre");
    expect(html).not.toContain('aria-label="Hollow centre"');
    expect(html).not.toContain("Spokes to the centre");

    const spokes = { ...NO_EXTRAS, centre: "spokes" } as const;
    useToolStore.setState({ pendingShape: pend("spiral", OUTLINE, { extras: spokes }) });
    html = options();
    for (const label of ["Arms", "Turns", "Band", "Gaps"]) expect(html).toContain(`"${label}"`);
    expect(html).not.toContain('aria-label="Rings"');
    expect(html).toMatch(/checked=""[^>]*\/>Spokes to the centre/);

    useToolStore.setState({
      pendingShape: pend("circle", { kind: "scattered", spacing: 25, edge: true }),
    });
    html = options();
    expect(html).toContain('aria-label="Hollow centre"');
    for (const label of ["Band", "Rings", "Wobble", "Gaps"]) {
      expect(html).not.toContain(`aria-label="${label}"`);
    }
    expect(html).not.toContain("A system at the centre");
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

    PREVIEW.current = preview(24);
    const html = options();
    expect(html).toContain(">Place 24 systems<");
    expect(html).not.toMatch(/<button[^>]* disabled=""[^>]*>Place 24/);
  });
});

describe("the shape options on a save", () => {
  beforeEach(() => {
    onSave();
    useGeneratorStore.setState({ starClasses: STAR_CLASSES });
    useGameDataStore.setState({ status: "ready" });
  });

  it("offer Stars on a save only: Random, each class, and A mix…", () => {
    useToolStore.setState({ pendingShape: pend("circle", OUTLINE) });
    const html = options();
    const row = /aria-label="Stars"[^>]*>(.*?)<\/select>/.exec(html)![1];
    expect([...row.matchAll(/>([^<]+)<\/option>/g)].map((m) => m[1])).toEqual([
      "Random",
      "G · yellow",
      "M · red dwarf",
      "Pulsar",
      "A mix…",
    ]);
    expect(row).toContain('<option value="random" selected="">');
    expect(html).not.toMatch(/\/>Pulsar/);

    useFileSessionStore.setState({ kind: "scenario", capabilities: SCENARIO_CAPABILITIES });
    expect(options()).not.toContain('aria-label="Stars"');
  });

  it("show one class chosen, and a mix as a box per class with the ticked ones checked", () => {
    useToolStore.setState({
      pendingShape: pend("circle", OUTLINE, { stars: { kind: "one", class: "sc_m" } }),
    });
    expect(options()).toContain('<option value="one:sc_m" selected="">M · red dwarf</option>');

    useToolStore.setState({
      pendingShape: pend("circle", OUTLINE, { stars: { kind: "mix", classes: ["sc_pulsar"] } }),
    });
    const mix = options();
    expect(mix).toContain('<option value="mix" selected="">A mix…</option>');
    expect(mix).toMatch(/<input type="checkbox"(?![^>]*checked)[^>]*\/>G · yellow/);
    expect(mix).toContain('<input type="checkbox" disabled="" checked=""/>Pulsar');
  });

  it("show one class the game data lacks as chosen", () => {
    useToolStore.setState({
      pendingShape: pend("circle", OUTLINE, { stars: { kind: "one", class: "sc_gone" } }),
    });
    expect(options()).toContain(
      '<option value="one:sc_gone" selected="">sc_gone (not in the game data)</option>',
    );
  });

  it("hold the spacing to the game's 10 between systems, and the count to the save's cap", () => {
    useToolStore.setState({
      pendingShape: pend(
        "circle",
        { kind: "grid", spacing: 5, lattice: "square" },
        { shape: { ...SHAPE_SPECS.circle.initial, radius: 30 } },
      ),
    });
    const field = /min="([\d.]+)" max="150" step="0.1" aria-label="Spacing between/.exec(options());
    expect(Number(field![1])).toBe(10);

    useToolStore.setState({ pendingShape: pend("circle", OUTLINE) });
    expect(options()).toMatch(/min="2" max="200"[^>]*aria-label="Systems along the outline"/);
  });

  it("disable Place without game data and say why", () => {
    useToolStore.setState({ pendingShape: pend("circle", OUTLINE) });
    useGameDataStore.setState({ status: "idle" });
    PREVIEW.current = preview(24);
    const html = options();
    expect(html).toMatch(/<button[^>]* disabled=""[^>]*>Place 24 systems</);
    expect(html).toContain("Load game data to place a shape in a save.");

    PREVIEW.current = preview(24, Array(24).fill("sc_g"));
    expect(options()).not.toMatch(/<button[^>]* disabled=""[^>]*>Place 24/);
  });

  it("disable Place when none of the ticked stars can be rolled", () => {
    useToolStore.setState({ pendingShape: pend("circle", OUTLINE) });
    PREVIEW.current = preview(24, []);
    const html = options();
    expect(html).toMatch(/<button[^>]* disabled=""[^>]*>Place 24 systems</);
    expect(html).toContain("None of the ticked stars can be rolled. Tick another.");
  });
});
