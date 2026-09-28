import { useEffect, useMemo } from "react";
import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { OrbitPlacement } from "../generated/OrbitPlacement";
import type { PlanetMoveCheck } from "../generated/PlanetMoveCheck";
import type { PlanetMoveTargets } from "../generated/PlanetMoveTargets";
import { documentCapabilities } from "../lib/capabilities";
import { refusalLine } from "../lib/planetMove";
import { useEditorStore } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { sceneSystem } from "./sceneStore";

/** The bodies selected in one system's view, in the order they were picked. */
export interface BodySelection {
  system: number;
  ids: readonly number[];
}

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
  /** The bodies selected in the system view; null with none. */
  selection: BodySelection | null;
  /** Where the selection may move, fetched on a save whenever it changes; null while on its way. */
  selectionTargets: PlanetMoveTargets | null;
  cut: PlanetCut | null;
  /** The core's checks for destinations the cut's targets do not settle, by `checkKey`. */
  checks: ReadonlyMap<string, PlanetMoveCheck>;
  /** Selects body `id` of `system` alone. */
  selectBody(system: number, id: number): void;
  /**
   * Adds body `id` to the selection, or takes it out. A body of another system starts a new
   * selection, and so does any toggle on a document whose planets cannot move.
   */
  toggleBody(system: number, id: number): void;
  clearBodies(): void;
  /** Cuts the selection, replacing any cut. False when the selection cannot be cut now. */
  cutSelection(): boolean;
  /** Drops the cut, and says whether there was one. */
  cancelCut(): boolean;
  /** Asks the core what a paste of the cut onto `to`, at `at` if given, would meet; null with no cut. */
  checkPaste(to: number, at?: OrbitPlacement | null): Promise<PlanetMoveCheck | null>;
  /**
   * Moves the cut planets to `to` in one edit, a lone one at `at` if given. The cut goes, the
   * moved planets become the selection in `to`, and on the galaxy map `to` becomes the selected
   * system.
   */
  paste(to: number, at?: OrbitPlacement | null): Promise<boolean>;
  /** Moves `planets` to `to` in one edit, as a paste does, without touching the cut. */
  move(planets: readonly number[], to: number, at?: OrbitPlacement | null): Promise<boolean>;
  /**
   * Reads what the last edit, undo or redo may have changed: the selection's and the cut's
   * targets again, and no cached check. A cut whose planets have left its system goes.
   */
  refresh(): void;
  /** Keeps only the selected bodies `present` says are still in the selection's system. */
  keepBodies(present: (id: number) => boolean): void;
  reset(): void;
}

const NO_CHECKS: ReadonlyMap<string, PlanetMoveCheck> = new Map();

/** The key a check for `to` and `at` is cached under. */
export function checkKey(to: number, at?: OrbitPlacement | null): string {
  return at ? `${to}@${at.radius},${at.angle}` : `${to}`;
}

/** Whether the open document's planets can move: a save's can. */
function canMove(): boolean {
  return documentCapabilities(useFileSessionStore.getState()).details;
}

/** Bumped by every selection change and reset, so a late answer for an older one is dropped. */
let selectionAsk = 0;
/** Bumped by every cut change and reset. */
let cutAsk = 0;
/** Bumped by every cut the user makes, which a fresh read of its targets does not change. */
let cutMade = 0;

export const usePlanetMoveStore = create<PlanetMoveState>((set, get) => {
  function select(selection: BodySelection | null): void {
    selectionAsk += 1;
    set({ selection, selectionTargets: null });
    fetchSelectionTargets();
  }

  function fetchSelectionTargets(): void {
    const { selection } = get();
    if (selection === null || !canMove()) return;
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
    selection: null,
    selectionTargets: null,
    cut: null,
    checks: NO_CHECKS,

    selectBody(system, id) {
      select({ system, ids: [id] });
    },

    toggleBody(system, id) {
      const { selection } = get();
      if (selection === null || selection.system !== system || !canMove()) {
        select({ system, ids: [id] });
        return;
      }
      const ids = selection.ids.includes(id)
        ? selection.ids.filter((b) => b !== id)
        : [...selection.ids, id];
      select(ids.length === 0 ? null : { system, ids });
    },

    clearBodies() {
      if (get().selection !== null) select(null);
    },

    cutSelection() {
      const availability = cutAvailability(get());
      const { selection, selectionTargets } = get();
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
      if (!(await get().move(cut.planets, to, at))) return false;
      if (cutMade === made) get().cancelCut();
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
      if (!(await useEditorStore.getState().applyOp(op))) return false;
      select({ system: to, ids: [...planets] });
      if (sceneSystem() === null) await useEditorStore.getState().select(to);
      return true;
    },

    refresh() {
      const { selection, cut } = get();
      set({ checks: NO_CHECKS });
      if (selection !== null) {
        selectionAsk += 1;
        fetchSelectionTargets();
      }
      if (cut !== null) fetchCutTargets(cut);
    },

    keepBodies(present) {
      const { selection } = get();
      if (selection === null) return;
      const ids = selection.ids.filter(present);
      if (ids.length === selection.ids.length) return;
      select(ids.length === 0 ? null : { system: selection.system, ids });
    },

    reset() {
      selectionAsk += 1;
      cutAsk += 1;
      set({ selection: null, selectionTargets: null, cut: null, checks: NO_CHECKS });
    },
  };
});

/** Whether the selection can be cut: `none` with nothing selected or on a document whose planets cannot move. */
export function cutAvailability(
  state: Pick<PlanetMoveState, "selection" | "selectionTargets">,
): CutAvailability {
  const { selection, selectionTargets } = state;
  if (selection === null || !canMove()) return { kind: "none" };
  if (selectionTargets === null) return { kind: "pending" };
  const reason = refusalLine(selectionTargets.refused);
  if (reason !== null) return { kind: "refused", reason };
  return { kind: "ready", planets: selectionTargets.planets };
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
