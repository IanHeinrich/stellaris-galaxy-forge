import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import type { Op } from "../generated/Op";
import { editor, openFixtureSave } from "./editorFixture";
import { useEntityStore } from "./entityStore";
import { editResult, planetPage } from "./fixture";
import { name } from "../test/builders";
import { mockedIpc } from "../test/ipc";
import { until } from "../test/wait";

const getPlanetPage = mockedIpc.getPlanetPage;
const entities = () => useEntityStore.getState();

/** A star of Alpha Centauri and a world of Sol, whose pages the tests read. */
const STAR = 101;
const WORLD = 3;
const ALPHA = 1;
const SOL = 0;

const RETYPE: Op = { type: "SetStarClass", system: ALPHA, class: "sc_a", bodies: [] };
/** What the backend says a star-type edit, or its undo, rewrote: the system and its star. */
const ALPHA_EDITED = editResult({
  touched_entities: [
    { kind: "system", id: ALPHA },
    { kind: "planet", id: STAR },
  ],
});

async function readPages(): Promise<void> {
  entities().requestPlanetPage(STAR);
  entities().requestPlanetPage(WORLD);
  await until(() => expect(entities().pages.size).toBe(2));
}

beforeEach(async () => {
  await openFixtureSave();
  entities().clear();
  getPlanetPage.mockImplementation(async (id) =>
    planetPage({ id, system: id === STAR ? ALPHA : SOL, class: "pc_a_star" }),
  );
});

describe("a planet page after an edit", () => {
  it("stays while it is read again after a star-type edit to its system, then is swapped", async () => {
    await readPages();
    const before = entities().pages.get(STAR);
    mockedIpc.applyOp.mockResolvedValue(ALPHA_EDITED);

    await editor().applyOp(RETYPE);
    expect(entities().pages.get(STAR)).toBe(before);
    expect([...entities().stalePages]).toEqual([STAR]);

    let answer = (): void => undefined;
    getPlanetPage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = () => resolve(planetPage({ id: STAR, system: ALPHA, class: "pc_b_star" }));
        }),
    );
    entities().requestPlanetPage(STAR);
    expect(entities().pages.get(STAR)).toBe(before);
    answer();
    await until(() => expect(entities().pages.get(STAR)?.class).toBe("pc_b_star"));
    expect(entities().stalePages.size).toBe(0);
    expect(getPlanetPage).toHaveBeenCalledTimes(3);

    entities().requestPlanetPage(STAR);
    expect(getPlanetPage).toHaveBeenCalledTimes(3);
  });

  it("is made stale by an edit that rewrites only one of its moons", async () => {
    const MOON = 4;
    const moon = {
      id: MOON,
      name: name("NAME_Moon"),
      name_key: "NAME_Moon",
      class: "pc_barren",
      size: 6,
    };
    getPlanetPage.mockImplementation(async (id) =>
      planetPage({ id, system: SOL, moons: id === WORLD ? [moon] : [] }),
    );
    entities().requestPlanetPage(WORLD);
    await until(() => expect(entities().pages.has(WORLD)).toBe(true));

    entities().noteEdit(editResult({ touched_entities: [{ kind: "planet", id: MOON }] }));
    expect([...entities().stalePages]).toEqual([WORLD]);
  });

  it("is made stale by an undo to its system as by the edit", async () => {
    await readPages();
    mockedIpc.undo.mockResolvedValue(ALPHA_EDITED);

    await editor().undo();
    expect([...entities().stalePages]).toEqual([STAR]);

    entities().requestPlanetPage(STAR);
    await until(() => expect(entities().stalePages.size).toBe(0));
    expect(getPlanetPage).toHaveBeenCalledTimes(3);
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
    expect(entities().stalePages.size).toBe(0);
  });
});
