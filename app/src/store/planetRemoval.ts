/**
 * Deleting a save body and removing its colony: each asks the user first, applies one op, and
 * closes the inspector's pages on what went.
 */
import { confirm } from "@tauri-apps/plugin-dialog";
import * as ipc from "../api/ipc";
import {
  deleteOp,
  deleteQuestion,
  removeColonyOp,
  removeColonyQuestion,
} from "../lib/details/planetRemoval";
import { useEditorStore } from "./editorStore";
import { useInspectorStore } from "./inspectorStore";

/** Deletes body `planet`, named `name`, with its moons, once the user confirms. */
export async function deletePlanet(planet: number, name: string, moon: boolean): Promise<boolean> {
  const page = await ipc.getPlanetPage(planet);
  const question = deleteQuestion(page, name, moon);
  if (!(await confirm(question, { title: name, kind: "warning" }))) return false;
  if (!(await useEditorStore.getState().applyOp(deleteOp(planet)))) return false;
  const colonies = page.colony === null ? [] : [page.colony.id];
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
