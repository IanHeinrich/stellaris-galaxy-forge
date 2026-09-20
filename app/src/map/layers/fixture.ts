import { BitmapText, type Container, DOMAdapter, type Graphics } from "pixi.js";
import type { GalaxyView } from "../../generated/GalaxyView";
import type { SystemNode } from "../../generated/SystemNode";
import { Camera } from "../Camera";
import { EMPTY_CONTEXT, type RenderContext } from "../RenderContext";
import { SpatialGrid } from "../../lib/spatialGrid";
import { systemNode } from "../../test/builders";
import type { MapLayer } from "./MapLayer";

/** One instance for every context a test builds, so a layer sees a single galaxy throughout. */
const GALAXY = {} as GalaxyView;

/** A system on a row of the x axis, named by a literal the label layer draws as it stands. */
export function mapNode(id: number, x: number, label: string, initializer = ""): SystemNode {
  return systemNode({
    id,
    name: { key: label, literal: true, variables: [] },
    x,
    initializer,
  });
}

/** A context over `nodes`, as the controller would assemble one for a scenario document. */
export function mapContext(
  nodes: readonly SystemNode[],
  over: Partial<RenderContext> = {},
): RenderContext {
  const systems = new Map(nodes.map((n) => [n.id, n]));
  const grid = new SpatialGrid();
  grid.build(systems.values());
  return { ...EMPTY_CONTEXT, galaxy: GALAXY, kind: "scenario", systems, grid, ...over };
}

/** Drives one viewport pass at `scale`, centred on `at`, as the controller's ticker would. */
export function viewport(layer: MapLayer, scale: number, at = { x: 0, y: 0 }): void {
  const cam = new Camera();
  cam.setViewport(800, 600);
  cam.scale = scale;
  cam.x = at.x;
  cam.y = at.y;
  cam.rev++;
  layer.onViewport(cam, EMPTY_CONTEXT);
}

/** One fill or stroke a graphics has recorded, read out of PixiJS's own instruction list. */
export interface DrawOp {
  action: string;
  color: number | undefined;
  alpha: number | undefined;
  /** The path's steps in order: `"moveTo"`, `"circle"`, `"roundRect"`, … */
  steps: string[];
  /** One `[ax, ay, bx, by, …]` per straight the path lays down. */
  segments: number[][];
}

interface PathStep {
  action: string;
  data: unknown[];
}

interface DrawData {
  style?: { color?: number; alpha?: number };
  path?: { instructions: PathStep[] };
}

/** What the graphics has been told to draw, in order. */
export function drawOps(graphics: Graphics): DrawOp[] {
  return graphics.context.instructions.map((instruction) => {
    const { style, path } = instruction.data as unknown as DrawData;
    const steps = path?.instructions ?? [];
    const segments: number[][] = [];
    for (const step of steps) {
      const numbers = step.data.filter((value): value is number => typeof value === "number");
      if (step.action === "moveTo" || segments.length === 0) segments.push(numbers);
      else segments[segments.length - 1].push(...numbers);
    }
    return {
      action: instruction.action,
      color: style?.color,
      alpha: style?.alpha,
      steps: steps.map((step) => step.action),
      segments,
    };
  });
}

/** What the graphics has been told to stroke, one entry per stroked path. */
export function strokes(graphics: Graphics): DrawOp[] {
  return drawOps(graphics).filter((op) => op.action === "stroke");
}

/** The child container a layer draws one aspect into, by the label the layer gave it. */
export function childByLabel(container: Container, label: string): Container {
  const child = container.getChildByLabel(label);
  if (!child) throw new Error(`no child labelled ${label}`);
  return child;
}

/** Every label the layer is drawing, by text. */
export function drawnLabels(container: Container): BitmapText[] {
  return container.children.filter(
    (child): child is BitmapText => child instanceof BitmapText && child.visible,
  );
}

export function drawnText(container: Container): string[] {
  return drawnLabels(container)
    .map((label) => label.text)
    .sort();
}

/** Width of one character in the stub's measurements; the tests care about layout, not metrics. */
const STUB_CHAR_PX = 6;

function stubContext(): CanvasRenderingContext2D {
  const props = new Map<string | symbol, unknown>();
  const noop = (): undefined => undefined;
  return new Proxy({} as CanvasRenderingContext2D, {
    get(_target, key) {
      if (key === "measureText") {
        return (text: string) => ({
          width: text.length * STUB_CHAR_PX,
          actualBoundingBoxAscent: 8,
          actualBoundingBoxDescent: 2,
          actualBoundingBoxLeft: 0,
          actualBoundingBoxRight: text.length * STUB_CHAR_PX,
        });
      }
      if (key === "getImageData") {
        return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
      }
      return props.has(key) ? props.get(key) : noop;
    },
    set(_target, key, value) {
      props.set(key, value);
      return true;
    },
  });
}

function stubCanvas(): HTMLCanvasElement {
  const context = stubContext();
  return {
    width: 1,
    height: 1,
    style: {},
    getContext: () => context,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  } as unknown as HTMLCanvasElement;
}

class StubContext2D {
  letterSpacing = "";
}

/**
 * Lets PixiJS measure `BitmapText` without a DOM, so a test can drive a layer that sizes a
 * plate to its label. Called once, before the layer under test is built.
 */
export function stubTextMeasurement(): void {
  DOMAdapter.set({
    ...DOMAdapter.get(),
    createCanvas: () => stubCanvas(),
    getCanvasRenderingContext2D: () => StubContext2D as never,
  });
}
