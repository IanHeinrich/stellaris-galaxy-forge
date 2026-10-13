/**
 * Deleting a save body and removing its colony: each asks the user first, applies one op, and
 * closes the inspector's pages on what went.
 */
import * as ipc from "../api/ipc";
import type { PlanetPage } from "../generated/PlanetPage";
import { bodyName } from "../lib/details/labels";
import {
  deleteOp,
  deleteQuestion,
  removeColonyOp,
  removeColonyQuestion,
} from "../lib/details/planetRemoval";
import { confirmDeletion, Unreadable } from "./confirmDeletion";
import { useEditorStore } from "./editorStore";
import { useGameDataStore } from "./gameDataStore";

/** The pages of `page`'s moons; a moon that can't be read fails the read, naming it. */
async function moonPages(page: PlanetPage, name: string): Promise<PlanetPage[]> {
  const read = await Promise.allSettled(page.moons.map((m) => ipc.getPlanetPage(m.id)));
  return read.map((result, i) => {
    if (result.status === "fulfilled") return result.value;
    const moon = bodyName(page.moons[i], useGameDataStore.getState().names);
    throw new Unreadable(
      `Couldn't read ${moon}, a moon of ${name}, so nothing was deleted`,
      result.reason,
    );
  });
}

/** Deletes body `planet`, named `name`, with its moons, once the user confirms. */
export function deletePlanet(planet: number, name: string, moon: boolean): Promise<boolean> {
  return confirmDeletion({
    title: name,
    unreadable: `Couldn't read ${name}, so nothing was deleted`,
    async read() {
      const page = await ipc.getPlanetPage(planet);
      return { page, moons: await moonPages(page, name) };
    },
    question({ page, moons }) {
      const colonised = moons.filter((body) => body.colony !== null).length;
      return deleteQuestion(page, name, moon, colonised);
    },
    apply: () => useEditorStore.getState().applyOp(deleteOp(planet)),
    gone({ page, moons }) {
      const colonies = [page, ...moons].flatMap((body) =>
        body.colony === null ? [] : [body.colony.id],
      );
      return { planets: [planet, ...page.moons.map((m) => m.id)], colonies };
    },
  });
}

/** Removes the colony on body `planet`, named `name`, once the user confirms; the body stays. */
export function removeColony(planet: number, name: string): Promise<boolean> {
  return confirmDeletion({
    title: name,
    unreadable: `Couldn't read ${name}, so nothing was removed`,
    read: () => ipc.getPlanetPage(planet),
    question: (page) => (page.colony === null ? null : removeColonyQuestion(page, name)),
    apply: () => useEditorStore.getState().applyOp(removeColonyOp(planet)),
    gone: (page) => ({ colonies: page.colony === null ? [] : [page.colony.id] }),
  });
}
