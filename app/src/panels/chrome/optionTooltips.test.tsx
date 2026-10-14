import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

const PREVIEW = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../../store/shapePreview", async (actual) => ({
  ...(await actual<object>()),
  shapePreview: () => PREVIEW.current,
  useShapePreview: () => PREVIEW.current,
}));

import { BRUSH_TOOLS, type BrushTool } from "../../lib/brush/brushTools";
import { HEIGHT_MODES } from "../../lib/brush/heightBrush";
import { SAVE_CAPABILITIES, SCENARIO_CAPABILITIES } from "../../lib/capabilities";
import { EXTRA_KEYS, EXTRA_ROWS, NO_EXTRAS } from "../../lib/shapes/extras";
import {
  ARRANGE_LANE_CHOICES,
  FILL_CHOICES,
  fillChoiceHint,
  fillKindOf,
  SHAPE_OPTIONS,
} from "../../lib/shapes/shapeCopy";
import { SHAPE_KINDS, SHAPE_SPECS, specOf } from "../../lib/shapes/specs";
import type {
  Fill,
  FillChoice,
  PendingShape,
  ShapeKind,
  ShapePurpose,
} from "../../lib/shapes/types";
import {
  ERASE_TARGET_CHOICES,
  HEIGHT_MODE_ROWS,
  RIPPLE_PRESET_ROWS,
  TOOL_OPTIONS,
} from "../../lib/toolCopy";
import { useEditorStore } from "../../store/editorStore";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useGeneratorStore } from "../../store/generatorStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { useToolStore } from "../../store/toolStore";
import { ToolOptions } from "./ToolOptions";

/** The elements a player sets an option with. */
const CONTROLS = new Set(["button", "input", "select", "summary"]);

/**
 * Each control in `html` with no tooltip: no non-empty title on itself or on an element around
 * it, such as the label of its row.
 */
function untitled(html: string): string[] {
  const titled: boolean[] = [];
  const out: string[] = [];
  for (const [tag, close, name, attrs, selfClosing] of html.matchAll(
    /<(\/?)([a-z]+)([^>]*?)(\/?)>/g,
  )) {
    if (close) {
      titled.pop();
      continue;
    }
    const has = / title="[^"]+"/.test(attrs) || titled.at(-1) === true;
    if (CONTROLS.has(name) && !has) out.push(tag);
    if (!selfClosing) titled.push(has);
  }
  return out;
}

/** The markup with its apostrophes unescaped, to find a hint in. */
const plain = (html: string) => html.replace(/&#x27;/g, "'");

const options = () => plain(renderToStaticMarkup(<ToolOptions />));

/** A fill of each choice, as a new shape of it starts. */
const FILLS: Record<FillChoice, Fill> = {
  outline: { kind: "outline", count: 24 },
  scattered: { kind: "scattered", spacing: 25, edge: true },
  square: { kind: "grid", spacing: 25, lattice: "square" },
  hex: { kind: "grid", spacing: 25, lattice: "hex" },
};

/** A pending `kind` with `fill` and every option it can show turned on. */
function pend(kind: ShapeKind, fill: Fill, purpose: ShapePurpose = { kind: "add" }): PendingShape {
  return {
    purpose,
    shape: SHAPE_SPECS[kind].initial,
    fill,
    lanes: { follow: true, mode: "new", islands: false },
    extras: { ...NO_EXTRAS, band: 2, wobble: 10, centre: "spokes" },
    skipNear: true,
    stars: { kind: "mix", classes: ["sc_g"] },
    seed: 1,
  };
}

/** Every state of the Shape tool's options the tables give: each kind with each fill it takes, on a scenario and a save, and Arrange with each lane choice. */
function shapeStates(): PendingShape[] {
  const added = SHAPE_KINDS.flatMap((kind) =>
    FILL_CHOICES.filter((c) =>
      specOf(SHAPE_SPECS[kind].initial).fills(SHAPE_SPECS[kind].initial).includes(fillKindOf(c)),
    ).map((c) => pend(kind, FILLS[c])),
  );
  const arranged = ARRANGE_LANE_CHOICES.map((lanes) =>
    pend("circle", FILLS.outline, { kind: "arrange", ids: [1, 2, 3], lanes, alsoOuter: true }),
  );
  return [...added, ...arranged];
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
  useToolStore.setState({ ...useToolStore.getInitialState() });
  useMapChromeStore.setState({ ...useMapChromeStore.getInitialState() });
  useGeneratorStore.setState({
    starClasses: [{ key: "sc_g", label: "G · yellow", odds: 10, randomOdds: 10 }],
  });
  useGameDataStore.setState({ status: "ready" });
});

describe("the Shape tool's options", () => {
  it("give every option a tooltip in every state, and show every option's hint somewhere", () => {
    const seen: string[] = [];
    for (const [kind, capabilities] of [
      ["scenario", SCENARIO_CAPABILITIES],
      ["save", SAVE_CAPABILITIES],
    ] as const) {
      useFileSessionStore.setState({ kind, capabilities });
      useToolStore.setState({ tool: "shape", pendingShape: null });
      seen.push(options());
      for (const pending of shapeStates()) {
        useToolStore.setState({ pendingShape: pending });
        seen.push(options());
      }
    }
    for (const html of seen) expect(untitled(html)).toEqual([]);
    const all = seen.join("");
    const hints = [
      ...SHAPE_KINDS.flatMap((k) => [
        SHAPE_SPECS[k].hint,
        ...SHAPE_SPECS[k].fields.map((f) => f.hint),
      ]),
      ...FILL_CHOICES.map(fillChoiceHint),
      ...EXTRA_KEYS.map((k) => EXTRA_ROWS[k].hint),
      ...Object.values(SHAPE_OPTIONS).map((o) => o.hint),
    ];
    for (const hint of hints) {
      expect(hint).not.toBe("");
      // An icon's tooltip says its name on the line above the hint.
      expect(all.includes(`title="${hint}"`) || all.includes(`\n${hint}"`), hint).toBe(true);
    }
  });
});

describe("the brush options", () => {
  it("give every option a tooltip with each brush, mode and target, and show every option's hint somewhere", () => {
    const seen: string[] = [];
    for (const tool of Object.keys(BRUSH_TOOLS) as BrushTool[]) {
      useToolStore.setState({ tool });
      seen.push(options());
    }
    for (const heightMode of HEIGHT_MODES) {
      useToolStore.setState({ tool: "height", heightMode });
      seen.push(options());
    }
    for (const { value } of ERASE_TARGET_CHOICES) {
      useToolStore.setState({ tool: "erase", eraseTarget: value });
      seen.push(options());
    }
    for (const html of seen) expect(untitled(html)).toEqual([]);
    const all = seen.join("");
    for (const hint of [
      ...Object.values(TOOL_OPTIONS).map((o) => o.hint),
      ...Object.values(HEIGHT_MODE_ROWS).map((r) => r.title),
      ...Object.values(RIPPLE_PRESET_ROWS).map((r) => r.title),
    ]) {
      expect(hint).not.toBe("");
      expect(all).toContain(`title="${hint}"`);
    }
  });
});
