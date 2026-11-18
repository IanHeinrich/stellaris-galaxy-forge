import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
// The row icons come from the map's texture cache, which no test renderer can fill.
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));

import type { AmbientObject } from "../../../generated/AmbientObject";
import type { Capabilities } from "../../../generated/Capabilities";
import { documentCapabilities } from "../../../lib/capabilities";
import {
  AT_A_RANDOM_SPOT,
  NO_AMBIENT_OBJECTS,
  NO_MEGASTRUCTURES,
  ORIGIN_MARK_TEXT,
} from "../../../lib/details/placedRows";
import { bindStores } from "../../../store/bindStores";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { megastructureSummary, rowOrigin, structureSpawn } from "../../../test/builders";
import { systemSpawn } from "../../../test/spawn";
import { details, land, open, overview, resetStores, sections } from "../inspectorFixture";

bindStores();

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetStores();
});

/** The open document, with `on` switched on beside what it supports. */
function switchOn(...on: (keyof Capabilities)[]): void {
  const now = documentCapabilities(useFileSessionStore.getState());
  useFileSessionStore.setState({
    capabilities: { ...now, ...Object.fromEntries(on.map((key) => [key, true])) },
  });
}

/** A ruin's spawn from the block's row `id`, or from the initializer for null. */
const spawnFrom = (id: number | null, editable = true) => structureSpawn(rowOrigin(id, editable));

function object(over: Partial<AmbientObject>): AmbientObject {
  return {
    kind: "derelict_ship_object",
    place: { place: "random" },
    origin: rowOrigin(null),
    ...over,
  };
}

/** The markup of the row whose name is `name`, up to the next row. */
function rowOf(html: string, name: string): string {
  const start = html.indexOf(name);
  expect(start, `a row for ${name}`).toBeGreaterThan(-1);
  const end = html.indexOf("ins-prow", start);
  return end === -1 ? html.slice(start) : html.slice(start, end);
}

describe("the Megastructures and Ambient objects sections", () => {
  it("show a save's Megastructures with none, saying how to add one", async () => {
    await open("save");
    await land(details());
    const html = overview();
    expect(sections(html)).toContain("Megastructures · 0");
    expect(html).toContain(NO_MEGASTRUCTURES);
  });

  it("show a scenario's Megastructures with none, and leave Ambient objects out until it can add one", async () => {
    await open("scenario");
    await land(details({ spawn: systemSpawn() }));
    let html = overview();
    expect(sections(html)).toContain("Megastructures · 0");
    expect(html).toContain(NO_MEGASTRUCTURES);
    expect(sections(html)).not.toContain("Ambient objects · 0");

    switchOn("ambient_objects");
    html = overview();
    expect(sections(html)).toContain("Megastructures · 0");
    expect(sections(html)).toContain("Ambient objects · 0");
    expect(html).toContain(NO_MEGASTRUCTURES);
    expect(html).toContain(NO_AMBIENT_OBJECTS);
  });

  it("show a scenario's ambient objects without the empty line while it can't add one", async () => {
    await open("scenario");
    await land(details({ spawn: systemSpawn({ ambient_objects: [object({})] }) }));
    const html = overview();
    expect(sections(html)).toContain("Ambient objects · 1");
    expect(html).not.toContain(NO_AMBIENT_OBJECTS);
    expect(rowOf(html, "Derelict Ship Object")).toContain(AT_A_RANDOM_SPOT);
  });

  it("mark each row the page can't edit with where it comes from", async () => {
    await open("scenario");
    useGameDataStore.setState({
      names: new Map([
        ["fx_sphere", "Fx Sphere"],
        ["fx_gate", "Fx Gate"],
        ["fx_yard", "Fx Yard"],
      ]),
    });
    await land(
      details({
        megastructures: [
          megastructureSummary({ id: 50, kind: "fx_sphere", spawn: spawnFrom(null) }),
          megastructureSummary({ id: 51, kind: "fx_gate", spawn: spawnFrom(51, false) }),
          megastructureSummary({ id: 52, kind: "fx_yard", spawn: spawnFrom(52) }),
        ],
        spawn: systemSpawn({
          ambient_objects: [
            object({ kind: "large_debris_object" }),
            object({
              kind: "abandoned_ship_object",
              place: { place: "point", x: 0, y: 30 },
              origin: rowOrigin(60),
            }),
          ],
        }),
      }),
    );
    let html = overview();
    const { initializer, file } = ORIGIN_MARK_TEXT;
    expect(rowOf(html, "Fx Sphere")).toContain(initializer);
    expect(rowOf(html, "Fx Gate")).toContain(file);
    const own = rowOf(html, "Fx Yard");
    expect(own).not.toContain(initializer);
    expect(own).not.toContain(file);
    expect(rowOf(html, "Large Debris Object")).toContain(initializer);
    expect(rowOf(html, "Abandoned Ship Object"), "the scenario can't move it yet").toContain(file);

    switchOn("ambient_objects");
    html = overview();
    expect(rowOf(html, "Abandoned Ship Object")).not.toContain(file);
  });

  it("mark no row of a save, which has one source", async () => {
    await open("save");
    await land(
      details({ megastructures: [megastructureSummary({ id: 6, kind: "think_tank_3" })] }),
    );
    const html = overview();
    expect(html).not.toContain(ORIGIN_MARK_TEXT.initializer);
    expect(html).not.toContain(ORIGIN_MARK_TEXT.file);
  });
});
