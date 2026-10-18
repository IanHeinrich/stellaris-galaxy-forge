/**
 * The words of the Inspector page for several selected systems, and of the system menu's items
 * for them. Where the page and the menu word one action differently, both wordings sit side by
 * side, named for where each is shown.
 */

import { counted } from "./text";

/** How Add lanes links the selection: each system to every other, or to its neighbours. */
export type LinkChoice = "every" | "nearby";

export const LINK_CHOICES: ReadonlyArray<{ choice: LinkChoice; label: string }> = [
  { choice: "every", label: "Every pair" },
  { choice: "nearby", label: "Nearby" },
];

/** Why Every pair is off for a selection of more than `max` systems. */
export function everyPairLimit(max: number): string {
  return `Every pair is for up to ${max} systems.`;
}

/** The page's one Add button; `n` is null while the nearby lanes are not counted. */
export function addLanesLabel(n: number | null): string {
  return n === null ? "Add lanes" : `Add ${counted(n, "lane")}`;
}

/** The menu's two add items, before their counts. */
export const LINK_EVERY_PAIR_ITEM = "Link every pair";
export const LINK_NEARBY_ITEM = "Link nearby";

/** The checkbox beside Lane density on the page, which the tools call Generate lanes like the game. */
export const LIKE_THE_GAME = "Like the game";

export const CUT_BETWEEN = "Cut lanes between them";
export const ISOLATE_THEM = "Isolate them";
export const RESET_LENGTHS = "Reset lane lengths";

/** The Shape block's button on the page, and the menu's item. */
export const ARRANGE_IN_SHAPE = "Arrange in a shape…";
export const ARRANGE_ITEM = "Arrange…";

/** The page's delete button for a selection the document deletes whole. */
export function deleteSystemsLabel(n: number): string {
  return `Delete ${counted(n, "system")}`;
}

export const ROTATE_NOTE = "Or drag the handle on the map. Shift snaps to 15°.";

export const FLATTEN_TITLE = "Back to the game's default height";
