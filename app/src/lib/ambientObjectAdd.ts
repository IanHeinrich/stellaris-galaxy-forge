/**
 * The Add ambient object browser: its words, the objects it lists under their headings, the
 * search over them, and what its preview says of the one picked.
 */
import type { AmbientObjectView } from "../generated/AmbientObjectView";
import { keyWords, needsGameData } from "./text";

export const ADD_AMBIENT_OBJECT_HERE_LABEL = "Add ambient object here…";

export const AMBIENT_OBJECTS_NEED_GAME_DATA = needsGameData("add an ambient object");

export const READING_AMBIENT_OBJECTS = "Reading the ambient objects…";

export const NO_AMBIENT_OBJECT_TYPES = "The game data has no ambient objects.";

export const NO_AMBIENT_OBJECT_MATCHES = "No ambient object matches.";

/** The heading of the objects an initializer places in its systems. */
export const PLACED_IN_SYSTEMS = "Placed in systems";

/** The heading of every other object, mods' included. */
export const OTHER_OBJECTS = "Other objects";

export const DELETE_AMBIENT_OBJECT = "Delete ambient object";

/** What the page and its fields say the object stands about. */
export const ABOUT_MAIN_STAR = "the system's main star";

/** The heading `view` is listed under. */
export function ambientObjectGroup(view: AmbientObjectView): string {
  return view.placed_by.length > 0 ? PLACED_IN_SYSTEMS : OTHER_OBJECTS;
}

/** Every object of `views`: those an initializer places first, then the rest, each by name. */
export function ambientObjectEntries(
  views: ReadonlyMap<string, AmbientObjectView>,
): AmbientObjectView[] {
  const placedFirst = (v: AmbientObjectView) => (v.placed_by.length > 0 ? 0 : 1);
  return [...views.values()].sort(
    (a, b) =>
      placedFirst(a) - placedFirst(b) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key),
  );
}

/** The entries whose name or key holds `query`, whatever its case, in their order. */
export function matchingAmbientObjects(
  entries: readonly AmbientObjectView[],
  query: string,
): readonly AmbientObjectView[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return entries;
  return entries.filter(
    (v) => v.name.toLowerCase().includes(needle) || v.key.toLowerCase().includes(needle),
  );
}

/** What the game does with `view` in a system: whether its name shows and whether it can be selected. */
export function inGameLines(view: AmbientObjectView): string[] {
  return [
    view.show_name ? "Visible by name" : "No name shown",
    view.selectable ? "Can be selected" : "Can't be selected",
  ];
}

/** What an object of type `kind` is called: its game data name, else its key made readable. */
export function ambientObjectName(
  kind: string,
  views: ReadonlyMap<string, AmbientObjectView> | null,
): string {
  return views?.get(kind)?.name ?? keyWords(kind);
}
