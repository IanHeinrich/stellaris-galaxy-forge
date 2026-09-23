/**
 * Every `localStorage` key the app writes, so no two features can collide on one.
 *
 * The rule for what earns a key: a toggle, slider or pick the user set by hand persists
 * per machine; a value the open document or the app itself decides does not.
 */
export const PREF_KEYS = {
  shownKinds: "sgf.layers.shownKinds",
  layers: "sgf.layers.visible",
  installPath: "sgf.installPath",
  autoLoad: "sgf.gameData.autoLoad",
  inspectorSections: "sgf.inspector.sections",
  dockWidth: "sgf.dock.width",
  dockCollapsed: "sgf.dock.collapsed",
  recents: "sgf.recents",
  initializerPins: "sgf.initializers.pinned",
  initializerRecent: "sgf.initializers.recent",
  initializerDefault: "sgf.initializers.default",
  nebulaRadius: "sgf.nebula.radius",
  meshBeta: "sgf.mesh.beta",
  brushSize: "sgf.brush.size",
  brushSpacing: "sgf.brush.spacing",
  brushLaneMode: "sgf.brush.laneMode",
  eraseTarget: "sgf.brush.eraseTarget",
  eraseSpecials: "sgf.brush.eraseSpecials",
  symmetry: "sgf.brush.symmetry",
  symmetryLast: "sgf.brush.symmetryLast",
  skippedUpdate: "sgf.update.skipped",
  noticedUpdate: "sgf.update.noticed",
  checkAtStart: "sgf.update.checkAtStart",
  paintProfile: "sgf.paint.profile",
  paintNoticeDismissed: "sgf.paint.noticeDismissed",
  warnNotForPaint: "sgf.paint.warnNotForPaint",
  watchlist: "sgf.search.watchlist",
  lgateRevealed: "sgf.lgate.revealed",
} as const;

/** The collapse memory of one browser list, which keys on the list's name. */
export function browserCollapseKey(list: string): `sgf.browser.${string}.flipped` {
  return `sgf.browser.${list}.flipped`;
}

export type PrefKey =
  (typeof PREF_KEYS)[keyof typeof PREF_KEYS] | ReturnType<typeof browserCollapseKey>;
