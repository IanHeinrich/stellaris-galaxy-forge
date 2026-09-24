import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import * as ipc from "../api/ipc";
import type { Op } from "../generated/Op";
import { editor, mocked, openFixtureSave } from "./editorFixture";
import { useEntityStore } from "./entityStore";
import { editResult, planetPage } from "./fixture";

const getPlanetPage = vi.mocked(ipc.getPlanetPage);
const entities = () => useEntityStore.getState();

/** A star of Alpha Centauri and a world of Sol, whose pages the tests read. */
const STAR = 101;
const WORLD = 3;
const ALPHA = 1;
const SOL = 0;

const RETYPE: Op = { type: "SetStarClass", id: ALPHA, class: "sc_a", bodies: [] };
/** What the backend says a star-type edit, or its undo, rewrote: the system, never the planet. */
const ALPHA_EDITED = editResult({ touched_entities: [{ kind: "system", id: ALPHA }] });

async function readPages(): Promise<void> {
  entities().requestPlanetPage(STAR);
  entities().requestPlanetPage(WORLD);
  await vi.waitFor(() => expect(entities().pages.size).toBe(2));
}

beforeEach(async () => {
  await openFixtureSave();
  entities().clear();
  getPlanetPage.mockImplementation(async (id) =>
    planetPage({ id, system: id === STAR ? ALPHA : SOL, class: "pc_a_star" }),
  );
});

describe("a planet page after an edit", () => {
  it("is read again once a star-type edit to its system has dropped it", async () => {
    await readPages();
    mocked.applyOp.mockResolvedValue(ALPHA_EDITED);

    await editor().applyOp(RETYPE);
    expect([...entities().pages.keys()]).toEqual([WORLD]);

    getPlanetPage.mockResolvedValueOnce(
      planetPage({ id: STAR, system: ALPHA, class: "pc_b_star" }),
    );
    entities().requestPlanetPage(STAR);
    await vi.waitFor(() => expect(entities().pages.get(STAR)?.class).toBe("pc_b_star"));
    expect(getPlanetPage).toHaveBeenCalledTimes(3);
  });

  it("is dropped by an undo to its system as by the edit", async () => {
    await readPages();
    mocked.undo.mockResolvedValue(ALPHA_EDITED);

    await editor().undo();
    expect(entities().pages.has(STAR)).toBe(false);
    expect(entities().pages.has(WORLD)).toBe(true);

    entities().requestPlanetPage(STAR);
    await vi.waitFor(() => expect(entities().pages.has(STAR)).toBe(true));
    expect(getPlanetPage).toHaveBeenCalledTimes(3);
  });

  it("is dropped when its system leaves the galaxy", async () => {
    await readPages();

    entities().noteEdit(editResult({ delta: { systems: [], removed: [SOL] } }));
    expect([...entities().pages.keys()]).toEqual([STAR]);
  });

  it("throws away a page read the edit overtook", async () => {
    let answer = (): void => undefined;
    getPlanetPage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = () => resolve(planetPage({ id: STAR, system: ALPHA }));
        }),
    );
    entities().requestPlanetPage(STAR);
    entities().noteEdit(ALPHA_EDITED);
    answer();
    await Promise.resolve();

    expect(entities().pages.has(STAR)).toBe(false);
    expect(entities().pending.size).toBe(0);
  });
});
