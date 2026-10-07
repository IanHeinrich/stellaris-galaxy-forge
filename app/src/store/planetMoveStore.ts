import { useEffect, useMemo } from "react";
import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { NewBody } from "../generated/NewBody";
import type { OrbitPlacement } from "../generated/OrbitPlacement";
import type { PlanetMoveCheck } from "../generated/PlanetMoveCheck";
import type { PlanetMoveTargets } from "../generated/PlanetMoveTargets";
import type { PlanetMoveWarning } from "../generated/PlanetMoveWarning";
import { documentCapabilities } from "../lib/capabilities";
import type { SystemDetails } from "../generated/SystemDetails";
import { bodyName } from "../lib/details/labels";
import { movingBodies, placementAt, refusalLine, type MovedPlanet } from "../lib/planetMove";
import { useDetailsStore } from "./detailsStore";
import { useEditorStore } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { useGameDataStore } from "./gameDataStore";
import { useInspectorStore } from "./inspectorStore";
import { sceneSystem, useSceneStore, type BodySelection } from "./sceneStore";

/** Planets cut and waiting for a paste. Nothing has moved. */
export interface PlanetCut {
  /** The planets that move, normalised by the core: a moon whose planet is cut too is left out. */
  planets: readonly number[];
  /** The system they stand in. */
  from: number;
  /** Where they may go, with the warnings each system gives. */
  targets: PlanetMoveTargets;
}

/**
 * Planets copied and waiting for a paste as new bodies. The copies hold everything a paste
 * needs, so they paste into another save too, and after the planets themselves are deleted.
 */
export interface PlanetCopy {
  /** What the core built of the copied planets, their moons inside them. */
  copies: readonly NewBody[];
  /** The copied planets as named when copied, one per copy: a moon copied alone arrives as a planet. */
  planets: readonly MovedPlanet[];
  /** The system they were copied from, in the document they were copied from. */
  from: number;
}

/** Where a planet may move as last read: its targets, or the failure to read them. */
export type TargetsRead = { targets: PlanetMoveTargets } | { failed: true };

/** Whether the selection can be cut now. */
export type CutAvailability =
  | { kind: "none" }
  | { kind: "pending" }
  | { kind: "refused"; reason: string }
  | { kind: "ready"; planets: readonly number[] };

export interface PlanetMoveState {
  /** Where the scene's body selection may move, fetched whenever it changes; null while on its way. */
  selectionTargets: PlanetMoveTargets | null;
  cut: PlanetCut | null;
  /** The copied planets. At most one of `cut` and `copy` is set: each replaces the other. */
  copy: PlanetCopy | null;
  /** The core's checks for destinations the cut's targets do not settle, by `checkKey`. */
  checks: ReadonlyMap<string, PlanetMoveCheck>;
  /**
   * The planet whose page offers its System field, and where it may move as last read. The last
   * answer stays while the next is on its way; `read` is null only before the first.
   */
  planetTargets: { planet: number; read: TargetsRead | null } | null;
  /** The warnings the last move from a planet's page met, until the next edit, undo or redo. */
  lastMove: { planet: number; warnings: readonly PlanetMoveWarning[] } | null;
  /** Reads where planet `id` may move, and again after every edit, undo and redo; null stops. */
  followPlanet(id: number | null): void;
  /** Cuts the selection, replacing any cut. False when the selection cannot be cut now. */
  cutSelection(): boolean;
  /** Drops the cut, and says whether there was one. */
  cancelCut(): boolean;
  /**
   * Copies the selection, replacing any cut or copy. False, with the core's refusal shown, when
   * the core refuses it; false too with nothing selected or on a document without bodies to add.
   */
  copySelection(): Promise<boolean>;
  /**
   * Drops the cut, or a copy this document can paste, and says whether there was one. A copy
   * still on its way is dropped too.
   */
  clearClipboard(): boolean;
  /** Asks the core what a paste of the cut onto `to`, at `at` if given, would meet; null with no cut. */
  checkPaste(to: number, at?: OrbitPlacement | null): Promise<PlanetMoveCheck | null>;
  /**
   * Moves the cut planets to `to` in one edit, a lone one at `at` if given, and the cut goes.
   * Two or more moved planets become the selection in `to`. In `to`'s view a lone one is
   * selected with its page open. On the galaxy map `to` becomes the selected system.
   * A copy is added to `to` as new bodies in one edit instead, a lone one at `at`, the rest in
   * the next free orbits. The copy stays to paste again, and on the galaxy map `to` becomes the
   * selected system.
   */
  paste(to: number, at?: OrbitPlacement | null): Promise<boolean>;
  /**
   * Moves `planets` to `to` in one edit, leaving the cut, the galaxy's selection and the
   * inspector as they were.
   */
  move(planets: readonly number[], to: number, at?: OrbitPlacement | null): Promise<boolean>;
  /**
   * Moves planet `id` to `to` from its page, in one edit, keeping the `warnings` its targets gave
   * as `lastMove`. In a system view the view follows it: `to` is shown centred on the planet, with
   * it selected alone and its page open. On the galaxy map it moves as `move` moves it.
   */
  movePlanet(id: number, to: number, warnings?: readonly PlanetMoveWarning[]): Promise<boolean>;
  /**
   * Reads what the last edit, undo or redo may have changed: the selection's and the cut's
   * targets again, pending until they land, and no cached check. A cut whose planets have left
   * its system goes.
   */
  refresh(): void;
  /** Asks again where the scene's body selection may move, as it has changed. */
  followSelection(): void;
  /** Forgets what belonged to the open document, a copy on its way included. A copy made stays. */
  reset(): void;
}

const NO_CHECKS: ReadonlyMap<string, PlanetMoveCheck> = new Map();

/** The key a check for `to` and `at` is cached under. */
export function checkKey(to: number, at?: OrbitPlacement | null): string {
  return at ? `${to}@${at.radius},${at.angle}` : `${to}`;
}

/** Whether the open document's planets can move. */
export function planetsCanMove(): boolean {
  return documentCapabilities(useFileSessionStore.getState()).planet_moves;
}

/** Whether the open document takes new bodies, and so copies of planets. */
export function bodiesCanCopy(): boolean {
  return documentCapabilities(useFileSessionStore.getState()).add_bodies;
}

/** Whether what `state` holds pastes into `to`: a cut into another system, a copy into any. */
export function pastesInto(state: Pick<PlanetMoveState, "cut" | "copy">, to: number): boolean {
  if (state.cut !== null) return state.cut.from !== to;
  return state.copy !== null && bodiesCanCopy();
}

/** Where the pointer last stood in the system view, where a pasted lone planet goes. */
let scenePointer: { system: number; x: number; y: number } | null = null;

/** Notes the system view's pointer at world point (x, y) of `system`; null once it has left. */
export function noteScenePointer(point: { system: number; x: number; y: number } | null): void {
  scenePointer = point;
}

/** The orbit a lone planet pasted into `system` at the pointer goes to; null away from it. */
export function pointerPlacement(system: number): OrbitPlacement | null {
  if (scenePointer === null || scenePointer.system !== system) return null;
  return placementAt(scenePointer.x, scenePointer.y);
}

/** Bumped by every selection change and reset, so a late answer for an older one is dropped. */
let selectionAsk = 0;
/** Bumped by every cut change and reset. */
let cutAsk = 0;
/** Bumped by every cut the user makes, which a fresh read of its targets does not change. */
let cutMade = 0;
/** Bumped by every read of a page's planet's targets and every reset. */
let planetAsk = 0;
/** Bumped by every copy, cut, clear and reset, so a late copy does not land after any of them. */
let copyAsk = 0;

/** `planets` and the moons that move with them, as the read details list them. */
function withMoons(planets: readonly number[]): number[] {
  const ids = new Set(planets);
  for (const read of useDetailsStore.getState().details.values()) {
    for (const p of read.planets)
      if (p.moon && p.parent !== null && ids.has(p.parent)) ids.add(p.id);
  }
  return [...ids];
}

/** The bodies of `ids` in `system` a copy takes, as named now: a moon goes inside its selected planet. */
function copiedPlanets(system: number, ids: readonly number[]): MovedPlanet[] {
  const read = useDetailsStore.getState().details.get(system);
  const names = useGameDataStore.getState().names;
  const planetOf = (id: number) => read?.planets.find((p) => p.id === id);
  return movingBodies(ids, (id) => planetOf(id)?.parent ?? null).map((id) => {
    const planet = planetOf(id);
    if (planet === undefined) return { name: `#${id}`, moon: false };
    return { name: bodyName(planet, names), moon: planet.moon === true };
  });
}

export const usePlanetMoveStore = create<PlanetMoveState>((set, get) => {
  const scene = () => useSceneStore.getState();

  function fetchSelectionTargets(): void {
    const selection = scene().bodySelection;
    if (selection === null || !planetsCanMove()) return;
    const ask = selectionAsk;
    ipc
      .planetMoveTargets([...selection.ids])
      .then((selectionTargets) => {
        if (ask === selectionAsk) set({ selectionTargets });
      })
      .catch((e: unknown) => {
        if (ask === selectionAsk) console.warn("planet move targets", ipc.errorMessage(e));
      });
  }

  function fetchCutTargets(cut: PlanetCut): void {
    const ask = ++cutAsk;
    ipc
      .planetMoveTargets([...cut.planets])
      .then((targets) => {
        if (ask !== cutAsk || get().cut !== cut) return;
        const left = targets.systems.some((s) => s.system === cut.from);
        set({ cut: left ? null : { ...cut, planets: targets.planets, targets } });
      })
      .catch(() => {
        if (ask === cutAsk && get().cut === cut) set({ cut: null });
      });
  }

  function fetchPlanetTargets(planet: number): void {
    const ask = ++planetAsk;
    ipc
      .planetMoveTargets([planet])
      .then((targets) => {
        if (ask === planetAsk) set({ planetTargets: { planet, read: { targets } } });
      })
      .catch((e: unknown) => {
        console.warn("planet move targets", ipc.errorMessage(e));
        if (ask === planetAsk) set({ planetTargets: { planet, read: { failed: true } } });
      });
  }

  async function pasteCopy(
    copy: PlanetCopy,
    to: number,
    at?: OrbitPlacement | null,
  ): Promise<boolean> {
    if (!bodiesCanCopy()) return false;
    let op;
    try {
      op = await ipc.pasteBodiesOp(to, [...copy.copies], at ?? null);
    } catch (e) {
      useFileSessionStore.getState().setError(ipc.errorMessage(e));
      return false;
    }
    if (!(await useEditorStore.getState().applyOp(op))) return false;
    if (sceneSystem() === null) await useEditorStore.getState().select(to);
    return true;
  }

  return {
    selectionTargets: null,
    cut: null,
    copy: null,
    checks: NO_CHECKS,
    planetTargets: null,
    lastMove: null,

    cutSelection() {
      const selection = scene().bodySelection;
      const { selectionTargets } = get();
      const availability = cutAvailability(selection, selectionTargets);
      if (availability.kind !== "ready" || selection === null || selectionTargets === null) {
        return false;
      }
      cutAsk += 1;
      cutMade += 1;
      copyAsk += 1;
      set({
        cut: { planets: availability.planets, from: selection.system, targets: selectionTargets },
        copy: null,
        checks: NO_CHECKS,
      });
      return true;
    },

    cancelCut() {
      if (get().cut === null) return false;
      cutAsk += 1;
      set({ cut: null, checks: NO_CHECKS });
      return true;
    },

    async copySelection() {
      const selection = scene().bodySelection;
      if (selection === null || !bodiesCanCopy()) return false;
      const ask = ++copyAsk;
      let copies;
      try {
        copies = await ipc.copyBodies([...selection.ids]);
      } catch (e) {
        if (ask === copyAsk) useFileSessionStore.getState().setError(ipc.errorMessage(e));
        return false;
      }
      if (ask !== copyAsk) return false;
      const named = copiedPlanets(selection.system, selection.ids);
      const planets =
        named.length === copies.length
          ? named
          : copies.map(() => ({ name: "a planet", moon: false }));
      cutAsk += 1;
      set({ copy: { copies, planets, from: selection.system }, cut: null, checks: NO_CHECKS });
      return true;
    },

    clearClipboard() {
      copyAsk += 1;
      if (get().cancelCut()) return true;
      if (get().copy === null || !bodiesCanCopy()) return false;
      set({ copy: null });
      return true;
    },

    async checkPaste(to, at) {
      const { cut } = get();
      if (cut === null) return null;
      const known = pasteCheckOf(cut, get().checks, to, at);
      if (known !== null) return known;
      try {
        const check = await ipc.planetMoveCheck([...cut.planets], to, at ?? null);
        if (get().cut === cut) {
          set({ checks: new Map([...get().checks, [checkKey(to, at), check]]) });
        }
        return check;
      } catch (e) {
        console.warn("planet move check", ipc.errorMessage(e));
        return null;
      }
    },

    async paste(to, at) {
      const { cut, copy } = get();
      if (cut === null) return copy !== null && pasteCopy(copy, to, at);
      const made = cutMade;
      const { planets } = cut;
      if (!(await get().move(planets, to, at))) return false;
      if (cutMade === made) get().cancelCut();
      const shown = sceneSystem();
      if (shown === to && planets.length === 1) scene().showBody(to, planets[0]);
      else {
        const moved = shown === to || planets.length > 1 ? { system: to, ids: [...planets] } : null;
        scene().selectBodies(moved);
      }
      if (shown === null) await useEditorStore.getState().select(to);
      return true;
    },

    async move(planets, to, at) {
      let op;
      try {
        op = await ipc.planetMoveOp([...planets], to, at ?? null);
      } catch (e) {
        useFileSessionStore.getState().setError(ipc.errorMessage(e));
        return false;
      }
      const moving = withMoons(planets);
      if (!(await useEditorStore.getState().applyOp(op))) return false;
      useInspectorStore.getState().moveBodies(moving, to);
      return true;
    },

    async movePlanet(id, to, warnings = []) {
      set({ lastMove: null });
      if (!(await get().move([id], to))) return false;
      if (warnings.length > 0) set({ lastMove: { planet: id, warnings } });
      if (sceneSystem() !== null) scene().goToBody(to, id);
      return true;
    },

    followPlanet(id) {
      planetAsk += 1;
      if (id === null) {
        set({ planetTargets: null });
        return;
      }
      if (get().planetTargets?.planet !== id) set({ planetTargets: { planet: id, read: null } });
      fetchPlanetTargets(id);
    },

    refresh() {
      const { cut, planetTargets } = get();
      set({ checks: NO_CHECKS, lastMove: null });
      if (scene().bodySelection !== null) get().followSelection();
      if (cut !== null) fetchCutTargets(cut);
      if (planetTargets !== null) fetchPlanetTargets(planetTargets.planet);
    },

    followSelection() {
      selectionAsk += 1;
      set({ selectionTargets: null });
      fetchSelectionTargets();
    },

    reset() {
      selectionAsk += 1;
      cutAsk += 1;
      planetAsk += 1;
      copyAsk += 1;
      set({
        selectionTargets: null,
        cut: null,
        checks: NO_CHECKS,
        planetTargets: null,
        lastMove: null,
      });
    },
  };
});

/** Whether `selection` can be cut: `none` with nothing selected or on a document whose planets cannot move. */
export function cutAvailability(
  selection: BodySelection | null,
  selectionTargets: PlanetMoveTargets | null,
): CutAvailability {
  if (selection === null || !planetsCanMove()) return { kind: "none" };
  if (selectionTargets === null) return { kind: "pending" };
  const reason = refusalLine(selectionTargets.refused);
  if (reason !== null) return { kind: "refused", reason };
  return { kind: "ready", planets: selectionTargets.planets };
}

/**
 * The planets a cut of `selection` takes: the core's answer once it is in, else the selected
 * bodies less any moon whose planet is selected too, as the details `read` place them.
 */
export function cutPlanets(
  selection: BodySelection | null,
  selectionTargets: PlanetMoveTargets | null,
  read: SystemDetails | undefined,
): readonly number[] {
  const availability = cutAvailability(selection, selectionTargets);
  if (availability.kind === "ready") return availability.planets;
  const parentOf = (id: number) => read?.planets.find((p) => p.id === id)?.parent ?? null;
  return movingBodies(selection?.ids ?? [], parentOf);
}

/**
 * What a paste of `cut` onto `to` meets, as far as is known without asking: a system the targets
 * list gives its warnings, a refused cut its refusal. Null means `checkPaste` has to ask.
 */
export function pasteCheckOf(
  cut: PlanetCut | null,
  checks: ReadonlyMap<string, PlanetMoveCheck>,
  to: number,
  at?: OrbitPlacement | null,
): PlanetMoveCheck | null {
  if (cut === null) return null;
  const refusal = refusalLine(cut.targets.refused);
  if (refusal !== null) return { refusal, warnings: [] };
  const cached = checks.get(checkKey(to, at));
  if (cached) return cached;
  if (at) return null;
  const target = cut.targets.systems.find((s) => s.system === to);
  return target ? { refusal: null, warnings: target.warnings } : null;
}

/** Where planet `id` may move, read while a page shows it; null before the first answer. */
export function usePlanetTargets(id: number): TargetsRead | null {
  const shown = usePlanetMoveStore((s) => s.planetTargets);
  useEffect(() => {
    usePlanetMoveStore.getState().followPlanet(id);
    return () => {
      const moves = usePlanetMoveStore.getState();
      if (moves.planetTargets?.planet === id) moves.followPlanet(null);
    };
  }, [id]);
  return shown?.planet === id ? shown.read : null;
}

/**
 * What a paste of the cut onto `to` meets, for a menu: null with no cut, or while the core is
 * asked about a destination the cut's targets do not settle.
 */
export function usePasteCheck(to: number, at?: OrbitPlacement | null): PlanetMoveCheck | null {
  const cut = usePlanetMoveStore((s) => s.cut);
  const checks = usePlanetMoveStore((s) => s.checks);
  const radius = at?.radius;
  const angle = at?.angle;
  const check = useMemo(() => {
    const place = radius === undefined || angle === undefined ? null : { radius, angle };
    return pasteCheckOf(cut, checks, to, place);
  }, [cut, checks, to, radius, angle]);
  useEffect(() => {
    if (cut === null || check !== null) return;
    const place = radius === undefined || angle === undefined ? null : { radius, angle };
    void usePlanetMoveStore.getState().checkPaste(to, place);
  }, [cut, check, to, radius, angle]);
  return check;
}
