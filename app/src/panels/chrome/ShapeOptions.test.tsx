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
import { drawnBy, lastDrawn } from "../../test/drawn";
import { ShapeOptions } from "./ShapeOptions";
import { ToolOptions } from "./ToolOptions";

const options = () => renderToStaticMarkup(<ShapeOptions />);

/** Each section of `html` by its heading's text, in the panel's order, with the markup under the heading. */
function sections(html: string): Map<string, string> {
  return new Map(
    [...html.matchAll(/<section[^>]*><h3[^>]*>([^<]+).*?<\/h3>(.*?)<\/section>/gs)].map((m) => [
      m[1],
      m[2],
    ]),
  );
}

/** A pending shape of `kind` with `fill`, lanes as a new outline starts them. */
function pend(kind: ShapeKind, fill: Fill, over: Partial<PendingShape> = {}): PendingShape {
  return {
    purpose: { kind: "add" },
    shape: SHAPE_SPECS[kind].initial,
    fill,
    lanes: { follow: fill.kind === "outline", mode: "off", islands: false },
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
            fill: { kind: "grid", spacing: 30, edge: false, lattice: "square" },
            lanes: { follow: false, mode: "new", islands: false },
            extras: NO_EXTRAS,
          },
        },
        skipNear: false,
      },
    });
    const html = options();
    expect(html).toContain("Drag on the map to draw a shape");
    expect(html).toMatch(/aria-checked="true" aria-label="Star"/);
    expect(html).toMatch(/aria-checked="true" title="[^"]*">Square grid</);
    expect(html).toContain("Points");
    expect(html).toContain("Inner radius");
    expect(html).toContain("System density");
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

  it("group the options under Shape, Fill, Size and form, Systems and Lanes, the fill bar and edge row in Fill", () => {
    useToolStore.setState({
      pendingShape: pend(
        "circle",
        { kind: "scattered", spacing: 25, edge: true },
        { lanes: { follow: true, mode: "new", islands: false } },
      ),
    });
    const parts = sections(options());
    expect([...parts.keys()]).toEqual(["Shape", "Fill", "Size and form", "Systems", "Lanes"]);
    expect(parts.get("Shape")).toMatch(/^<div class="segmented shape-tiles" role="radiogroup"/);
    expect(parts.get("Fill")).toMatch(
      /^<div class="segmented joined" role="radiogroup" aria-label="Fill">.*<\/div><label[^>]*><input type="checkbox"[^>]*\/>Line the edge with systems<\/label>$/,
    );
    for (const label of ["Size", "Arc", "Roundness", "Hollow centre"]) {
      expect(parts.get("Size and form")).toContain(`aria-label="${label}"`);
    }
    expect(parts.get("Systems")).toMatch(/System density.*Don&#x27;t place on top/);
    expect(parts.get("Lanes")).toMatch(/>Lanes<select.*Lane density.*Follow the shape/);
  });

  it("show one help link, on the Shape heading", () => {
    const html = renderToStaticMarkup(<ToolOptions />);
    expect(html.match(/class="link help-link"/g)).toHaveLength(1);
    expect(html).toMatch(
      /<h3[^>]*>Shape<button[^>]*class="link help-link"[^>]*>\?<\/button><\/h3>/,
    );
  });

  it("put the outline's extras in Size and form, the centre system in Systems and its spokes in Lanes", () => {
    const extras = { ...NO_EXTRAS, centre: "spokes" } as const;
    useToolStore.setState({ pendingShape: pend("circle", OUTLINE, { extras }) });
    const parts = sections(options());
    for (const label of ["Band", "Rings", "Wobble", "Gaps"]) {
      expect(parts.get("Size and form")).toContain(`aria-label="${label}"`);
    }
    expect(parts.get("Systems")).toContain("A system at the centre");
    expect(parts.get("Lanes")).toMatch(/Follow the shape.*Spokes to the centre/);
  });

  it("show Fill with a single choice, and leave out Size and form when nothing is in it", () => {
    useToolStore.setState({ pendingShape: pend("line", OUTLINE) });
    const fill = sections(options()).get("Fill")!;
    expect(fill.match(/role="radio"/g)).toHaveLength(1);

    const memory = useToolStore.getState().shapeMemory;
    useToolStore.setState({
      pendingShape: null,
      shapeMemory: {
        ...memory,
        kind: "rect",
        kinds: {
          ...memory.kinds,
          rect: {
            shape: SHAPE_SPECS.rect.initial,
            fill: { kind: "scattered", spacing: 25, edge: true },
            lanes: { follow: true, mode: "new", islands: false },
            extras: NO_EXTRAS,
          },
        },
      },
    });
    expect([...sections(options()).keys()]).toEqual(["Shape", "Fill", "Systems", "Lanes"]);
  });

  it("start Arrange's Lanes with what becomes of the selection's lanes, and show Gaps only under Rebuild", () => {
    const arrange = (lanes: "keep" | "rebuild") =>
      pend("circle", OUTLINE, {
        purpose: { kind: "arrange", ids: [1, 2, 3], lanes, alsoOuter: false },
      });
    useToolStore.setState({ pendingShape: arrange("keep") });
    let parts = sections(options());
    expect(parts.get("Lanes")).toMatch(
      /^<div class="segmented joined" role="radiogroup" aria-label="Lanes between the selected systems">.*<\/div>$/,
    );
    expect(parts.get("Systems")).toMatch(/title="[^"]+">Selected<span class="muted">3 systems</);
    expect(parts.get("Size and form")).not.toContain('aria-label="Gaps"');

    useToolStore.setState({ pendingShape: arrange("rebuild") });
    parts = sections(options());
    expect(parts.get("Size and form")).toContain('aria-label="Gaps"');
    expect(parts.get("Lanes")).toMatch(
      /aria-label="Lanes between the selected systems">.*Follow the shape.*Also remove lanes to other systems/,
    );
  });

  it("offer every kind of shape in the picker, the pending one checked", () => {
    useToolStore.setState({ pendingShape: pend("polygon", OUTLINE) });
    const html = options();
    for (const label of ["Line", "Circle", "Polygon", "Rectangle", "Star"]) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    expect(html).toMatch(/aria-checked="true" aria-label="Polygon"/);
    expect(html).toContain(`title="Polygon\n${SHAPE_SPECS.polygon.hint}"`);
    expect(html).toMatch(/aria-checked="false" aria-label="Circle"/);
  });

  it("show Systems for an outline, and System density with an exact Spacing for a fill", () => {
    useToolStore.setState({ pendingShape: pend("circle", OUTLINE) });
    const outline = options();
    expect(outline).toMatch(/<label class="tool-option" title="[^"]*">How many<input/);
    expect(outline).toMatch(/min="2" max="1000"[^>]*aria-label="Systems along the outline"/);
    expect(outline).not.toContain("System density");
    expect(outline).not.toContain(">Spacing<");

    useToolStore.setState({
      pendingShape: pend("circle", { kind: "scattered", spacing: 25, edge: true }),
    });
    const scattered = options();
    expect(scattered).toMatch(
      />System density<span class="shape-density"><span class="muted">sparse<.*>dense</,
    );
    expect(scattered).toMatch(/<details.*>Spacing<input[^>]*aria-label="Spacing between/);
    expect(scattered).not.toContain("Systems along the outline");
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
    expect(outline).toMatch(/aria-checked="true" title="[^"]*">Outline</);
    expect(outline.match(/role="radiogroup"/g)).toHaveLength(2);
    expect(outline).not.toContain("Shuffle");

    useToolStore.setState({
      pendingShape: pend("rect", { kind: "scattered", spacing: 25, edge: true }),
    });
    expect(options()).toMatch(/aria-checked="true" title="[^"]*">Scattered</);
    expect(options()).toMatch(
      /<div class="shape-foot">.*>Place<.*title="Shuffle\n[^"]+" aria-label="Shuffle"/s,
    );

    useToolStore.setState({
      pendingShape: pend("rect", { kind: "grid", spacing: 25, edge: false, lattice: "hex" }),
    });
    const grid = options();
    expect(grid).toMatch(
      /aria-checked="false" title="[^"]*">Square grid<.*aria-checked="true" title="[^"]*">Hex grid</,
    );
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

  it("offer the edge row for a scattered or grid fill, and Follow the shape only while there is one", () => {
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
      pendingShape: pend("circle", { kind: "grid", spacing: 25, edge: false, lattice: "square" }),
    });
    const grid = options();
    expect(grid).toMatch(
      /<input type="checkbox"(?![^>]*checked)[^>]*\/>Line the edge with systems/,
    );
    expect(grid).not.toContain("Follow the shape");

    useToolStore.setState({
      pendingShape: pend("circle", { kind: "grid", spacing: 25, edge: true, lattice: "hex" }),
    });
    const linedGrid = options();
    expect(linedGrid).toMatch(/checked=""[^>]*\/>Line the edge with systems/);
    expect(linedGrid).toContain("Follow the shape");
  });

  it("start System density at the closest spacing that fills the whole shape, and show the one used", () => {
    useToolStore.setState({
      pendingShape: pend(
        "circle",
        { kind: "grid", spacing: 5, edge: false, lattice: "square" },
        { shape: { ...SHAPE_SPECS.circle.initial, radius: 500 } },
      ),
    });
    const html = options();
    const field =
      /min="([\d.]+)" max="150" step="0.1" aria-label="Spacing between[^"]*" style="[^"]*" value="([\d.]+)"/.exec(
        html,
      );
    expect(Number(field![1])).toBeGreaterThan(5);
    expect(Number(field![2])).toBe(Number(field![1]));
    // Dense is at the right, and the densest the fill takes is the slider's end.
    const slider = /min="0" max="(\d+)" aria-label="System density" value="(\d+)"/.exec(html);
    expect(Number(slider![2])).toBe(Number(slider![1]));
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

  it("show a galaxy's shapes by the game's names and descriptions, with no outline or edge row", () => {
    useGameDataStore.setState({
      names: new Map([
        ["bar", "Barred Spiral"],
        ["spoked", "Spoked"],
        ["GALAXY_SHAPE_BAR_DESC", "Barred Spiral: two thick arms."],
      ]),
    });
    const galaxy = { ...SHAPE_SPECS.galaxy.initial, form: "bar" } as const;
    const scattered = { kind: "scattered", spacing: 25, edge: true } as const;
    useToolStore.setState({
      pendingShape: pend("galaxy", scattered, {
        shape: galaxy,
        lanes: { follow: false, mode: "new", islands: false },
      }),
    });
    const html = options();
    expect(html).toContain('aria-label="Galaxy shape"');
    expect(html).toMatch(/<option value="bar" selected="">Barred Spiral<\/option>/);
    expect(html).toContain('<option value="spoked">Spoked</option>');
    expect(html).toContain('<option value="cartwheel">cartwheel</option>');
    expect(html).toContain('title="Barred Spiral: two thick arms."');
    expect(html).not.toContain(">Outline<");
    expect(html).not.toContain("Line the edge with systems");
    expect(html).not.toContain("Follow the shape");
    expect(html).not.toContain('aria-label="Hollow centre"');
  });

  it("show Lane density only while Lanes is not off", () => {
    useToolStore.setState({ pendingShape: pend("circle", OUTLINE) });
    expect(options()).not.toContain("Lane density");

    useToolStore.setState({
      pendingShape: pend("circle", OUTLINE, {
        lanes: { follow: true, mode: "new", islands: false },
      }),
    });
    const html = options();
    expect(html).toContain('<option value="new" selected="">Among new</option>');
    expect(html).toContain("Lane density");
  });

  it("show the shape's own Lanes choice, not the paint brush's", () => {
    useToolStore.setState({
      pendingShape: pend("circle", OUTLINE, {
        lanes: { follow: true, mode: "new", islands: false },
      }),
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
    expect(html).toMatch(/<summary[^>]*>Exact values<\/summary>/);
    expect(html).toContain('aria-label="Centre x in game units"');

    useToolStore.setState({ pendingShape: pend("circle", OUTLINE, { skipNear: false }) });
    expect(options()).not.toMatch(/checked=""[^>]*\/>Don&#x27;t/);
  });

  it("apply a typed value on Enter even when it reads as the rounded value shown", () => {
    const shape = { ...SHAPE_SPECS.circle.initial, centre: { x: 0.04, y: 0 } };
    useToolStore.setState({ pendingShape: pend("circle", OUTLINE, { shape }) });
    drawnBy(options);
    const field = lastDrawn(
      ({ type, props }) => type === "input" && props["aria-label"] === "Centre x in game units",
      "Centre x",
    ) as { value: string; onChange(e: unknown): void; onKeyDown(e: unknown): void };
    expect(field.value).toBe("0");
    const input = { value: "0", blur: () => {} };
    field.onKeyDown({ key: "Enter", currentTarget: input });
    expect(useToolStore.getState().pendingShape!.shape).toMatchObject({ centre: { x: 0.04 } });

    field.onChange({ target: input });
    field.onKeyDown({ key: "Enter", currentTarget: input });
    expect(useToolStore.getState().pendingShape!.shape).toMatchObject({ centre: { x: 0, y: 0 } });
  });

  it("show exact values to a decimal place, two for a finer step, in fields wide enough for them", () => {
    useToolStore.setState({
      pendingShape: pend("rect", OUTLINE, {
        shape: {
          kind: "rect",
          centre: { x: -1234.5678, y: 1.24 },
          width: 101.3456,
          height: 101.84,
          rotation: 0,
        },
      }),
    });
    const rect = options();
    const field = (label: string) =>
      new RegExp(`aria-label="${label}" style="--chars:(\\d+)" value="([^"]*)"`)
        .exec(rect)!
        .slice(1);
    expect(field("Centre x in game units")).toEqual(["7", "-1234.6"]);
    expect(field("Centre y in game units")).toEqual(["7", "1.2"]);
    expect(field("Width in game units")).toEqual(["6", "101.3"]);
    expect(field("Height in game units")).toEqual(["6", "101.8"]);
    expect(field("Rotation in degrees")).toEqual(["5", "0"]);
    expect(useToolStore.getState().pendingShape!.shape).toMatchObject({ width: 101.3456 });

    useToolStore.setState({
      pendingShape: pend("spiral", OUTLINE, {
        shape: { ...SHAPE_SPECS.spiral.initial, turns: 2.25 },
      }),
    });
    expect(options()).toMatch(/aria-label="Turns as a number" style="--chars:4" value="2.25"/);
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
        { kind: "grid", spacing: 5, edge: false, lattice: "square" },
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

describe("the shape options with symmetry", () => {
  it("say that the shape is copied while symmetry is on, in Place and Arrange, and say nothing with it off", () => {
    const arrange = pend("circle", OUTLINE, {
      purpose: { kind: "arrange", ids: [1, 2], lanes: "keep", alsoOuter: false },
    });
    for (const pending of [null, pend("circle", OUTLINE), arrange]) {
      useToolStore.setState({ pendingShape: pending });
      useToolStore.getState().setSymmetry({ kind: "off" });
      expect(options()).not.toContain("Symmetry:");

      useToolStore.getState().setSymmetry({ kind: "rotate", n: 4 });
      const html = options();
      expect(html).toMatch(
        /<span class="tool-hint muted" title="[^"]+">Symmetry: 4-fold rotation, 4 copies<\/span>/,
      );
      expect(html.indexOf("Symmetry: 4-fold")).toBeLessThan(html.indexOf('class="shape-foot"'));

      useToolStore.getState().setSymmetry({ kind: "mirror", axis: "y" });
      expect(options()).toContain("Symmetry: Mirror left–right, 2 copies");
    }
  });
});
