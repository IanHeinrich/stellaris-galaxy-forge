/**
 * Deleting a save body and removing its colony: each asks the user first, applies one op, and
 * closes the inspector's pages on what went.
 */
import { confirm } from "@tauri-apps/plugin-dialog";
import * as ipc from "../api/ipc";
import type { PlanetPage } from "../generated/PlanetPage";
import { bodyName } from "../lib/details/labels";
import {
  deleteOp,
  deleteQuestion,
  removeColonyOp,
  removeColonyQuestion,
} from "../lib/details/planetRemoval";
import { useEditorStore } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { useGameDataStore } from "./gameDataStore";
import { useInspectorStore } from "./inspectorStore";

/** The pages of `page`'s moons, or `null` once the session says which one could not be read. */
async function moonPages(page: PlanetPage, name: string): Promise<PlanetPage[] | null> {
  const read = await Promise.allSettled(page.moons.map((m) => ipc.getPlanetPage(m.id)));
  const pages: PlanetPage[] = [];
  for (const [i, result] of read.entries()) {
    if (result.status === "rejected") {
      const why = ipc.errorMessage(result.reason);
      const moon = bodyName(page.moons[i], useGameDataStore.getState().names);
      useFileSessionStore
        .getState()
        .setError(`Couldn't read ${moon}, a moon of ${name}, so nothing was deleted: ${why}`);
      return null;
    }
    pages.push(result.value);
  }
  return pages;
}

/** Deletes body `planet`, named `name`, with its moons, once the user confirms. */
export async function deletePlanet(planet: number, name: string, moon: boolean): Promise<boolean> {
  const page = await ipc.getPlanetPage(planet);
  const moons = await moonPages(page, name);
  if (moons === null) return false;
  const colonies = [page, ...moons].flatMap((body) =>
    body.colony === null ? [] : [body.colony.id],
  );
  const colonisedMoons = moons.filter((body) => body.colony !== null).length;
  const question = deleteQuestion(page, name, moon, colonisedMoons);
  if (!(await confirm(question, { title: name, kind: "warning" }))) return false;
  if (!(await useEditorStore.getState().applyOp(deleteOp(planet)))) return false;
  useInspectorStore.getState().dropPlanets([planet, ...page.moons.map((m) => m.id)], colonies);
  return true;
}

/** Removes the colony on body `planet`, named `name`, once the user confirms; the body stays. */
export async function removeColony(planet: number, name: string): Promise<boolean> {
  const page = await ipc.getPlanetPage(planet);
  if (page.colony === null) return false;
  const question = removeColonyQuestion(page, name);
  if (!(await confirm(question, { title: name, kind: "warning" }))) return false;
  if (!(await useEditorStore.getState().applyOp(removeColonyOp(planet)))) return false;
  useInspectorStore.getState().dropPlanets([], [page.colony.id]);
  return true;
}
