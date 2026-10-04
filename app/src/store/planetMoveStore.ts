import { useEffect, useMemo } from "react";
import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { OrbitPlacement } from "../generated/OrbitPlacement";
import type { PlanetMoveCheck } from "../generated/PlanetMoveCheck";
import type { PlanetMoveTargets } from "../generated/PlanetMoveTargets";
import { documentCapabilities } from "../lib/capabilities";
import type { SystemDetails } from "../generated/SystemDetails";
import { movingBodies, refusalLine } from "../lib/planetMove";
import { useEditorStore } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
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
  /** The core's checks for destinations the cut's targets do not settle, by `checkKey`. */
  checks: ReadonlyMap<string, PlanetMoveCheck>;
  /** Cuts the selection, replacing any cut. False when the selection cannot be cut now. */
  cutSelection(): boolean;
  /** Drops the cut, and says whether there was one. */
  cancelCut(): boolean;
  /** Asks the core what a paste of the cut onto `to`, at `at` if given, would meet; null with no cut. */
  checkPaste(to: number, at?: OrbitPlacement | null): Promise<PlanetMoveCheck | null>;
  /**
   * Moves the cut planets to `to` in one edit, a lone one at `at` if given, and the cut goes.
   * Two or more moved planets become the selection in `to`. In `to`'s view a lone one is
   * selected with its page open. On the galaxy map `to` becomes the selected system.
   */
  paste(to: number, at?: OrbitPlacement | null): Promise<boolean>;
  /**
   * Moves `planets` to `to` in one edit, leaving the cut, the galaxy's selection and the
   * inspector as they were.
   */
  move(planets: readonly number[], to: number, at?: OrbitPlacement | null): Promise<boolean>;
  /**
   * Moves planet `id` to `to` from its page, in one edit. In a system view the view follows it:
   * `to` is shown centred on the planet, with it selected alone and its page open. On the galaxy
   * map it moves as `move` moves it.
   */
  movePlanet(id: number, to: number): Promise<boolean>;
  /**
   * Reads what the last edit, undo or redo may have changed: the selection's and the cut's
   * targets again, pending until they land, and no cached check. A cut whose planets have left
   * its system goes.
   */
  refresh(): void;
  /** Asks again where the scene's body selection may move, as it has changed. */
  followSelection(): void;
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

/** Bumped by every selection change and reset, so a late answer for an older one is dropped. */
let selectionAsk = 0;
/** Bumped by every cut change and reset. */
let cutAsk = 0;
/** Bumped by every cut the user makes, which a fresh read of its targets does not change. */
let cutMade = 0;

export const usePlanetMoveStore = create<PlanetMoveState>((set, get) => {
  const scene = () => useSceneStore.getState();

  /**
   * Shows system `to` centred on its body `id`, selected alone with its page open. The page opens
   * above `to`'s own, which the inspector would otherwise restart on as the selection follows.
   */
  function followTo(to: number, id: number): void {
    useSceneStore.getState().enterSystem(to);
    const label = useGalaxyStore.getState().systemName(to);
    useInspectorStore.getState().setRoot({ ref: { kind: "system", id: to }, label });
    scene().showBody(to, id);
    scene().focusBody(id);
  }

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

  return {
    selectionTargets: null,
    cut: null,
    checks: NO_CHECKS,

    cutSelection() {
      const selection = scene().bodySelection;
      const { selectionTargets } = get();
      const availability = cutAvailability(selection, selectionTargets);
      if (availability.kind !== "ready" || selection === null || selectionTargets === null) {
        return false;
      }
      cutAsk += 1;
      cutMade += 1;
      set({
        cut: { planets: availability.planets, from: selection.system, targets: selectionTargets },
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
      const { cut } = get();
      if (cut === null) return false;
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
      return useEditorStore.getState().applyOp(op);
    },

    async movePlanet(id, to) {
      if (!(await get().move([id], to))) return false;
      if (sceneSystem() !== null) followTo(to, id);
      return true;
    },

    refresh() {
      const { cut } = get();
      set({ checks: NO_CHECKS });
      if (scene().bodySelection !== null) get().followSelection();
      if (cut !== null) fetchCutTargets(cut);
    },

    followSelection() {
      selectionAsk += 1;
      set({ selectionTargets: null });
      fetchSelectionTargets();
    },

    reset() {
      selectionAsk += 1;
      cutAsk += 1;
      set({ selectionTargets: null, cut: null, checks: NO_CHECKS });
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
