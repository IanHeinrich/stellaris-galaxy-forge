import { GUIDE_URL } from "../generated/shell";
import type { AppIssueCode } from "./issues";
import { issueTitle } from "./issueCopy";

/** Where each "?" in the app opens the guide: a page under its root, then a heading after `#`. */
export const GUIDE_PLACES = {
  issues: "safety/issues",
  prepare: "scenario/prepare",
  paintChoice: "scenario/paint-a-galaxy#tick-the-paint-a-galaxy-checkbox",
  gameData: "start/game-data",
  gameDataSetup: "start/game-data#set-it-up-the-first-time",
  saving: "safety/saving#save-your-edits",
  changedOnDisk: "reference/troubleshooting#save-says-the-file-changed-on-disk",
  steamCloud: "safety/steam-cloud",
  laneBrushes: "edit/brushes#connect-and-cut-lanes-with-a-brush",
  paintBrushes: "edit/brushes#paint-and-erase-systems",
  heightBrush: "edit/heights#shape-heights-with-the-height-brush",
  symmetry: "edit/brushes#use-symmetry",
  newScenario: "scenario/make-a-scenario",
  exportScenario: "scenario/make-a-scenario#start-a-scenario",
  initializers: "scenario/initializers",
} as const satisfies Record<string, string>;

export type GuidePlace = keyof typeof GUIDE_PLACES;

const CONTROL_MAX = "\u001f";
const SPECIAL = /[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g;
const COMBINING = /[̀-ͯ]/g;

/** The anchor the guide gives a heading: the slug rule VitePress uses (`@mdit-vue/shared`). */
export function guideSlug(heading: string): string {
  return Array.from(heading.normalize("NFKD").replace(COMBINING, ""))
    .filter((c) => c > CONTROL_MAX)
    .join("")
    .replace(SPECIAL, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^(\d)/, "_$1")
    .toLowerCase();
}

/** The Issues page's heading for one kind of finding, titled as the Issues tab titles it. */
export function issueAnchor(code: AppIssueCode): string {
  return guideSlug(issueTitle(code));
}

/** The guide's address for `place`; `anchor` names a heading in place of the table's. */
export function guideUrl(place: GuidePlace, anchor?: string): string {
  const [page, own] = GUIDE_PLACES[place].split("#");
  const heading = anchor ?? own;
  return `${GUIDE_URL}${page}${heading === undefined ? "" : `#${heading}`}`;
}
