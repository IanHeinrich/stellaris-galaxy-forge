import { Container, Graphics } from "pixi.js";
import { beforeEach, describe, expect, it } from "vitest";

import type { StarbaseSummary } from "../../generated/StarbaseSummary";
import type { SystemDetails } from "../../generated/SystemDetails";
import type { Wayline } from "../../generated/Wayline";
import type { Waystation } from "../../generated/Waystation";
import { SAVE_CAPABILITIES } from "../../lib/capabilities";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { name, systemDetails } from "../../test/builders";
import { DETAIL_SCALE } from "../../lib/visual/labels";
import type { RenderContext } from "../RenderContext";
import {
  childByLabel,
  mapContext,
  mapNode,
  strokes,
  stubTextMeasurement,
  viewport,
} from "./fixture";
import { layersFor } from "./registry";
import { WaylinesLayer } from "./WaylinesLayer";

stubTextMeasurement();

const SYSTEMS = [mapNode(0, 0, "Sol"), mapNode(1, 40, "Alpha"), mapNode(2, 80, "Beta")];

const STATIONS: Waystation[] = [
  { system: 0, starbase: 10, network: 1 },
  { system: 1, starbase: 11, network: 1 },
  { system: 2, starbase: 12, network: 1 },
];

const LINES: Wayline[] = [
  { a: 0, b: 1, network: 1 },
  { a: 1, b: 2, network: 1 },
];

function starbase(id: number, level: string): StarbaseSummary {
  return {
    id,
    level,
    kind: "swaystation",
    name: name("NAME_Station"),
    name_key: "NAME_Station",
    owner: null,
    modules: [],
    buildings: [],
    shipyard: false,
    hull: 0,
    max_hull: 0,
  };
}

/** Sol's station is a Wayport, Alpha's a Wayhold; Beta's system has not been read. */
const DETAILS: ReadonlyMap<number, SystemDetails> = new Map([
  [0, systemDetails({ id: 0, starbase: starbase(10, "starbase_level_waystation_2") })],
  [1, systemDetails({ id: 1, starbase: starbase(11, "starbase_level_waystation_3") })],
]);

function context(
  waylines: readonly Wayline[],
  stations: readonly Waystation[],
  over: Partial<RenderContext> = {},
): RenderContext {
  return mapContext(SYSTEMS, {
    waylines,
    waystations: new Map(stations.map((station) => [station.system, station])),
    ...over,
  });
}

/** Drawn at the zoom system names show at, where every station's badge is its ring alone. */
function drawn(
  waylines: readonly Wayline[] = LINES,
  stations: readonly Waystation[] = STATIONS,
  over: Partial<RenderContext> = {},
): WaylinesLayer {
  const layer = new WaylinesLayer();
  layer.rebuild(context(waylines, stations, over));
  viewport(layer, DETAIL_SCALE);
  return layer;
}

function bands(layer: WaylinesLayer): Graphics {
  return childByLabel(layer.container, "bands") as Graphics;
}

function badges(layer: WaylinesLayer): Container[] {
  return childByLabel(layer.container, "badges").children.filter((c): c is Container => c.visible);
}

function text(root: Container): { text: string } {
  const label = root.children.find((c) => "text" in c) as { text: string } | undefined;
  if (!label) throw new Error("badge has no label");
  return label;
}

function plate(root: Container): Graphics {
  const found = root.children
    .filter((c): c is Graphics => c instanceof Graphics)
    .find((g) => g.eventMode === "static");
  if (!found) throw new Error("badge has no plate");
  return found;
}

/** Whether the plate sits above the star or below it. */
function side(root: Container): "above" | "below" {
  return plate(root).bounds.maxY < 0 ? "above" : "below";
}

beforeEach(() => {
  useMapChromeStore.setState({ ...useMapChromeStore.getInitialState() });
});

describe("the waylines layer", () => {
  it("lays one grey band along every wayline", () => {
    const drawnBands = strokes(bands(drawn()));
    expect(drawnBands).toHaveLength(2);
    for (const band of drawnBands) expect(band).toMatchObject({ color: 0xd6dde3, alpha: 0.35 });
    const xs = drawnBands[0].segments.flatMap((segment) => [segment[0], segment[2]]);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(40);
  });

  it("dashes the band, its ink twice its gaps", () => {
    const [band] = strokes(bands(drawn([LINES[0]])));
    expect(band.segments.length).toBeGreaterThan(1);
    const [first, second] = band.segments;
    const ink = first[2] - first[0];
    expect(ink).toBeCloseTo(2 * (second[0] - first[2]));
  });

  it("badges every station with the level its starbase has reached", () => {
    const layer = drawn(LINES, STATIONS, { details: DETAILS });
    expect(badges(layer).map((root) => text(root).text)).toEqual([
      "Wayport",
      "Wayhold",
      "Waystation",
    ]);
  });

  it("puts the badge on the side the bypass badge leaves free", () => {
    // A bypass badge takes the far side of `badgeSide`, so a station's takes that side itself.
    expect(badges(drawn()).map(side)).toEqual(["above", "above", "above"]);
  });

  it("names the stations on the whole-galaxy view and rings them alone once system names show", () => {
    const layer = drawn();
    for (const root of badges(layer)) {
      expect(plate(root).visible).toBe(false);
      expect(root.children.filter((c) => c.visible)).toHaveLength(1);
    }

    viewport(layer, 1);
    for (const root of badges(layer)) expect(plate(root).visible).toBe(true);
  });

  it("draws above the territories, beside the bypass badges and under the system names", () => {
    const order = layersFor(SAVE_CAPABILITIES).map((entry) => entry.id);
    expect(order.indexOf("waylines")).toBeGreaterThan(order.indexOf("owners"));
    expect(order.indexOf("waylines")).toBe(order.indexOf("bypasses") - 1);
    expect(order.indexOf("waylines")).toBeLessThan(order.indexOf("labels"));
  });

  it("drops a band when a delta drops its wayline", () => {
    const layer = drawn();
    layer.rebuild(context([LINES[0]], STATIONS));
    layer.applyDelta();
    expect(strokes(bands(layer))).toHaveLength(1);
  });

  it("names the station, its network and the stations standing in it", () => {
    const layer = drawn(LINES, STATIONS, { details: DETAILS });
    const [badge] = badges(layer);

    plate(badge).emit("pointerover", { global: { x: 4, y: 6 } } as never);
    expect(useMapChromeStore.getState().tooltip).toMatchObject({
      title: "Wayport",
      lines: ["Sol", "Network 1 · 3 stations"],
    });

    plate(badge).emit("pointerout", {} as never);
    expect(useMapChromeStore.getState().tooltip).toBeNull();
  });

  it("hands bands and badges to the one switch, so nothing shows with the layer off", () => {
    const layer = drawn();
    layer.setVisible(false);
    expect(layer.container.visible).toBe(false);
    expect(bands(layer).parent).toBe(layer.container);
    expect(childByLabel(layer.container, "badges").parent).toBe(layer.container);
  });
});
