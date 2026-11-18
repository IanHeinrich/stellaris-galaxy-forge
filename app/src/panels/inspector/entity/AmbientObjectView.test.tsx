import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/events");
vi.mock("../../useTextureUrl", () => ({ useTextureUrl: () => undefined }));
vi.mock("zustand", () => import("../../../test/zustandSnapshot"));

import type { RowOrigin } from "../../../generated/RowOrigin";
import { mainStarPoint } from "../../../lib/details/ambientObjects";
import { polar } from "../../../lib/details/orbits";
import { bindStores } from "../../../store/bindStores";
import { editResult, orbitClasses } from "../../../store/fixture";
import { useGameDataStore } from "../../../store/gameDataStore";
import { ambientObjectEntry, useInspectorStore } from "../../../store/inspectorStore";
import { systemGeometry } from "../../../store/systemGeometry";
import { ambientObjectView, offCentreMainStar, rowOrigin } from "../../../test/builders";
import { drawnBy, drawnField } from "../../../test/drawn";
import { mockedIpc } from "../../../test/ipc";
import { systemSpawn } from "../../../test/spawn";
import { TextField } from "../../EditField";
import { details, land, open, resetStores, SYSTEM } from "../inspectorFixture";
import { AmbientObjectView } from "./AmbientObjectView";

bindStores();

const OBJECT = 0x6000_0040;

/** A scenario whose system, its main star off the centre, holds a derelict 50 from that star. */
async function withObject(origin: RowOrigin = rowOrigin(OBJECT)): Promise<string> {
  resetStores();
  await open("scenario");
  useGameDataStore.setState({
    planetClasses: orbitClasses(),
    ambientObjects: new Map([
      [
        "derelict_ship_object",
        ambientObjectView("derelict_ship_object", { name: "Derelict Ship" }),
      ],
    ]),
  });
  const place = { place: "point", x: 50, y: 0 } as const;
  await land(
    details({
      planets: offCentreMainStar({ id: SYSTEM }).planets,
      spawn: systemSpawn({
        ambient_objects: [{ kind: "derelict_ship_object", place, origin }],
      }),
    }),
  );
  const entry = ambientObjectEntry(SYSTEM, OBJECT, "Derelict Ship");
  useInspectorStore.setState({ stack: [entry], tab: "overview" });
  return drawnBy(() => renderToStaticMarkup(<AmbientObjectView entry={entry} />));
}

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

describe("an ambient object's page", () => {
  it("shows its name, its distance and angle from the main star, what the game does with it, and Delete", async () => {
    const html = await withObject();
    expect(html).toContain("Derelict Ship");
    expect(html).toContain("Ambient object in");
    expect(html).toMatch(/aria-label="Distance"[^>]*value="50"/);
    expect(html).toMatch(/aria-label="Angle"[^>]*value="0"/);
    expect(html).toContain("Visible by name, Can be selected");
    expect(html).toContain("Delete ambient object");
    expect(mockedIpc.checkOp).toHaveBeenCalledWith({
      type: "RemoveAmbientObject",
      ambient_object: OBJECT,
    });
  });

  it("sends the distance typed as a move about the main star", async () => {
    await withObject();
    mockedIpc.applyOp.mockResolvedValue(editResult());
    const distance = drawnField(TextField, "Distance") as { onCommit(v: number): void };
    distance.onCommit(80);
    await vi.advanceTimersByTimeAsync(0);
    const { frame } = systemGeometry(SYSTEM);
    const star = mainStarPoint(frame.layout, frame.details);
    expect(Math.hypot(star.x, star.y)).toBeGreaterThan(0);
    const to = polar(0, 0, 80, 0);
    expect(mockedIpc.applyOp).toHaveBeenCalledWith({
      type: "MoveAmbientObject",
      ambient_object: OBJECT,
      x: expect.closeTo(to.x),
      y: expect.closeTo(to.y),
    });
  });

  it("offers no position or Delete for an object the file writes in a way the editor doesn't edit", async () => {
    const html = await withObject(rowOrigin(OBJECT, false));
    expect(html).toContain("Derelict Ship");
    expect(html).not.toContain("Distance");
    expect(html).not.toContain("Delete ambient object");
  });

  it("says so once the object is gone", async () => {
    resetStores();
    await open("scenario");
    await land(details({ spawn: systemSpawn() }));
    const entry = ambientObjectEntry(SYSTEM, OBJECT, "Derelict Ship");
    const html = renderToStaticMarkup(<AmbientObjectView entry={entry} />);
    expect(html).toContain("This ambient object is not in the system.");
  });
});
