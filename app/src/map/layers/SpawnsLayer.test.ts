import { Graphics } from "pixi.js";
import { beforeEach, describe, expect, it } from "vitest";
import type { SystemNode } from "../../generated/SystemNode";
import type { SpawnScript } from "../../generated/SpawnScript";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { SpawnsLayer } from "./SpawnsLayer";
import { childByLabel, drawnText, mapContext, mapNode, strokes, viewport } from "./fixture";

function weighted(id: number, x: number, weight: number | null): SystemNode {
  return { ...mapNode(id, x, `S${id}`), spawn_weight: weight };
}

/** The mod idiom: a base of zero, one empire's modifier adding all the weight. */
function addedTo(node: SystemNode): SystemNode {
  return {
    ...node,
    spawn_modifiers: [
      { factor: null, add: 10000, trigger: "has_country_flag = x", country_flag: "x" },
    ],
  };
}

/** The same spawn point, with an author's own modifier the editor shows and never reads into. */
function scaled(node: SystemNode): SystemNode {
  return {
    ...node,
    spawn_modifiers: [{ factor: 0, add: null, trigger: "is_ai = yes", country_flag: null }],
  };
}

const START = weighted(0, 0, 10);
const PLAIN = weighted(1, 20, null);

/** The colour the mark is stroked in, as the graphics context recorded it. */
function markColor(mark: Graphics): number | undefined {
  return strokes(mark)[0]?.color;
}

/** The mark on `id`, as the pointer would find it. */
function markOf(layer: SpawnsLayer, x: number): Graphics {
  const mark = layer.container.children.find(
    (child): child is Graphics => child instanceof Graphics && child.x === x,
  );
  if (!mark) throw new Error(`no mark at ${x}`);
  return mark;
}

/** The sub-container the layer draws a scripted seat's kind tags into. */
function tagsOf(layer: SpawnsLayer) {
  return childByLabel(layer.container, "tags");
}

/** A system scripted with the given Paint a Galaxy kind, as the projection would report it. */
function scriptedNode(
  id: number,
  x: number,
  kind: SpawnScript["paint_a_galaxy"]["kind"],
  player = false,
): SystemNode {
  return {
    ...weighted(id, x, 0),
    spawn_script: { paint_a_galaxy: { kind, random_value: 1, player } },
  };
}

/** Every mark the layer is drawing, by the system position it sits on. */
function marks(layer: SpawnsLayer): number[] {
  return layer.container.children
    .filter((child): child is Graphics => child instanceof Graphics && child.visible)
    .map((g) => g.x)
    .sort((a, b) => a - b);
}

function drawn(nodes: readonly SystemNode[]): SpawnsLayer {
  const layer = new SpawnsLayer();
  layer.rebuild(mapContext(nodes));
  viewport(layer, 1);
  return layer;
}

beforeEach(() => {
  useMapChromeStore.setState({ ...useMapChromeStore.getInitialState() });
});

describe("the spawn points layer", () => {
  it("marks a system the generator may start an empire in, and leaves the rest bare", () => {
    expect(marks(drawn([START, PLAIN]))).toEqual([START.x]);
  });

  it("marks a zero base a modifier adds the weight to, and leaves a bare zero unmarked", () => {
    const bare = weighted(2, 40, 0);
    expect(marks(drawn([bare, addedTo(weighted(3, 60, 0))]))).toEqual([60]);
  });

  it("drops the mark once a rebuild says the weight is gone", () => {
    const layer = drawn([START, PLAIN]);
    layer.rebuild(mapContext([weighted(START.id, START.x, null), PLAIN]));
    expect(marks(layer)).toEqual([]);
  });

  it("leaves the systems unwalked for a context change that cannot touch a seat", () => {
    const ctx = mapContext([START, PLAIN]);
    const layer = new SpawnsLayer();
    layer.rebuild(ctx);
    viewport(layer, 1);
    let walks = 0;
    const systems = ctx.systems as Map<number, SystemNode>;
    const values = systems.values.bind(systems);
    systems.values = () => {
      walks++;
      return values();
    };

    layer.rebuild({ ...ctx, names: new Map([["S0", "Sol"]]) });
    expect(walks).toBe(0);
    expect(marks(layer)).toEqual([START.x]);
  });

  it("follows a delta that gives a system a weight, moves it, and takes it away", () => {
    const layer = drawn([START, PLAIN]);
    layer.applyDelta({ systems: [weighted(PLAIN.id, PLAIN.x, 5)] });
    expect(marks(layer)).toEqual([START.x, PLAIN.x]);

    layer.applyDelta({ systems: [weighted(START.id, 60, 10)] });
    expect(marks(layer)).toEqual([PLAIN.x, 60]);

    layer.applyDelta({ systems: [weighted(START.id, 60, null)] });
    expect(marks(layer)).toEqual([PLAIN.x]);
  });

  it("says what the mark is and the weight it carries while the pointer is on it", () => {
    const layer = drawn([START, PLAIN]);
    const mark = markOf(layer, START.x);
    expect(mark.hitArea?.contains(0, 0)).toBe(false);

    mark.emit("pointerover", { global: { x: 4, y: 6 } } as never);
    expect(useMapChromeStore.getState().tooltip).toMatchObject({
      title: "S0",
      lines: ["Spawn point · weight 10"],
    });

    mark.emit("pointerout", {} as never);
    expect(useMapChromeStore.getState().tooltip).toBeNull();
  });

  it("marks a seat Paint a Galaxy scripts, and names the seat rather than its zero weight", () => {
    const scripted: SystemNode = {
      ...weighted(2, 40, 0),
      spawn_script: { paint_a_galaxy: { kind: { reserved: "b" }, random_value: 1, player: false } },
    };
    const layer = drawn([scripted, PLAIN]);
    expect(marks(layer)).toEqual([40]);

    markOf(layer, 40).emit("pointerover", { global: { x: 4, y: 6 } } as never);
    expect(useMapChromeStore.getState().tooltip).toMatchObject({
      title: "S2",
      lines: ["Spawn point · Paint a Galaxy reserved B"],
    });
  });

  it("draws every seat in the one colour, whatever modifiers the file adds to it", () => {
    const layer = drawn([scaled(START), addedTo(weighted(3, 60, 0)), weighted(2, 40, 5)]);
    for (const x of [START.x, 40, 60]) expect(markColor(markOf(layer, x))).toBe(0xfbbf24);
  });

  it("says only the weight while the pointer is on a seat with a modifier", () => {
    const layer = drawn([scaled(START)]);
    const mark = markOf(layer, START.x);

    mark.emit("pointerover", { global: { x: 4, y: 6 } } as never);
    expect(useMapChromeStore.getState().tooltip).toMatchObject({
      lines: ["Spawn point · weight 10"],
    });
  });

  it("draws a reserved seat's letter over a rounded tag beside the marker", () => {
    const layer = drawn([scriptedNode(2, 40, { reserved: "b" })]);
    expect(drawnText(tagsOf(layer))).toEqual(["B"]);
    expect(tagsOf(layer).children.filter((c) => c instanceof Graphics)).toHaveLength(1);
  });

  it("keeps the letters on the chip through a zoom, both scaling from the marker", () => {
    const layer = drawn([scriptedNode(2, 40, { reserved: "b" })]);
    const chip = tagsOf(layer).children.find((c) => c instanceof Graphics)!;
    const letters = tagsOf(layer).children.find((c) => !(c instanceof Graphics))!;
    const offset = () => ({ x: letters.x - chip.x, y: letters.y - chip.y });
    const before = { ...offset(), scale: chip.scale.x };
    viewport(layer, 4);
    const grown = chip.scale.x / before.scale;
    expect(grown).not.toBeCloseTo(1, 5);
    expect(offset().x).toBeCloseTo(before.x * grown, 5);
    expect(offset().y).toBeCloseTo(before.y * grown, 5);
    expect(letters.scale.x).toBe(chip.scale.x);
  });

  it("draws Sol's letters the same way as a reserved seat's", () => {
    const layer = drawn([scriptedNode(2, 40, "sol")]);
    expect(drawnText(tagsOf(layer))).toEqual(["Sol"]);
  });

  it("draws a star beside a preferred seat's marker, spelling out nothing", () => {
    const layer = drawn([scriptedNode(2, 40, "preferred")]);
    expect(drawnText(tagsOf(layer))).toEqual([]);
    expect(tagsOf(layer).children.filter((c) => c instanceof Graphics)).toHaveLength(1);
  });

  it("draws a P over the chip beside the player's seat, and names the seat while hovered", () => {
    const layer = drawn([scriptedNode(2, 40, "preferred", true)]);
    expect(drawnText(tagsOf(layer))).toEqual(["P"]);

    markOf(layer, 40).emit("pointerover", { global: { x: 4, y: 6 } } as never);
    expect(useMapChromeStore.getState().tooltip).toMatchObject({
      lines: ["Spawn point · Paint a Galaxy player"],
    });
  });

  it("draws no tag beside an enabled seat's marker", () => {
    const layer = drawn([scriptedNode(2, 40, "enabled")]);
    expect(tagsOf(layer).children.filter((c) => c.visible)).toHaveLength(0);
  });

  it("updates the tag when a delta changes the seat's kind, and drops it when the script goes", () => {
    const reservedA = scriptedNode(2, 40, { reserved: "a" });
    const layer = drawn([reservedA]);
    expect(drawnText(tagsOf(layer))).toEqual(["A"]);

    layer.applyDelta({ systems: [{ ...reservedA, spawn_script: null, spawn_weight: 1 }] });
    expect(drawnText(tagsOf(layer))).toEqual([]);
    expect(tagsOf(layer).children.filter((c) => c.visible)).toHaveLength(0);

    layer.applyDelta({ systems: [scriptedNode(2, 40, "sol")] });
    expect(drawnText(tagsOf(layer))).toEqual(["Sol"]);
  });
});
