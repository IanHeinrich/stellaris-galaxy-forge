import type { StoreApi } from "zustand";
import * as ipc from "../api/ipc";
import type { FeZone } from "../generated/FeZone";
import type { SystemNode } from "../generated/SystemNode";
import { linkedAnchors, linkedTo, linkRefusal, unlinkRefusal } from "../lib/feLinks";
import {
  feZoneBlocked,
  feZoneCentre,
  feZoneRefusal,
  firstFreeDirection,
  newFeZone,
  NO_FREE_DIRECTION,
  snapFeZone,
} from "../lib/feZone";
import { nearestSystem, refuseOr, systems, type RunEdit } from "./editorEdits";
import type { EditorState } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { useMapChromeStore } from "./mapChromeStore";

export const NEEDS_A_SYSTEM =
  "Add a system first. A fallen empire zone belongs to one of your systems.";

/** What the status bar says when a fit would change no zone. */
export const NOTHING_TO_FIT = "The automatic fallen empire zones already stand as asked.";

/** What the history calls a fit. */
const RECOMPUTE_FE_ZONES = "Recompute automatic fallen empire zones";

type FeZoneActions = Pick<
  EditorState,
  | "setFeZone"
  | "addFeZone"
  | "addFeZoneAt"
  | "moveFeZone"
  | "promptFeZoneFit"
  | "cancelFeZoneFit"
  | "fitFeZones"
  | "linkToFeZone"
  | "linkToFeZoneAll"
  | "unlinkFromFeZone"
  | "resetFeLinks"
  | "dropDanglingFeLinks"
>;

export function feZoneActions(
  set: StoreApi<EditorState>["setState"],
  get: StoreApi<EditorState>["getState"],
  runEdit: RunEdit,
): FeZoneActions {
  /** Writes a zone by hand, shows the rings, and selects the anchor so the inspector shows it. */
  async function placeFeZone(id: number, zone: FeZone): Promise<boolean> {
    if (!(await get().setFeZone(id, zone))) return false;

    useMapChromeStore.getState().setLayerQuietly("feZones", true);
    await get().select(id);
    return true;
  }

  /** Writes the zone's whole set of linked systems, and shows the rings once it has. */
  async function setFeLinks(anchor: number, linked: number[]): Promise<boolean> {
    const applied = (await runEdit(() => ipc.setFeLinks(anchor, linked))) !== null;
    if (applied) useMapChromeStore.getState().setLayerQuietly("feZones", true);
    return applied;
  }

  return {
    async setFeZone(id, zone) {
      return get().applyOp({ type: "SetFeZone", id, zone });
    },

    async addFeZone(id) {
      const anchor = systems().get(id);
      if (!anchor) return false;
      const direction = firstFreeDirection(anchor, systems());
      if (direction === null) {
        useFileSessionStore.getState().setError(NO_FREE_DIRECTION);
        return false;
      }
      return placeFeZone(id, newFeZone(direction));
    },

    async addFeZoneAt(point) {
      const anchor = nearestSystem(point);
      if (!anchor) {
        useFileSessionStore.getState().setError(NEEDS_A_SYSTEM);
        return false;
      }
      const snapped = snapFeZone(anchor, point);
      const blocked = feZoneBlocked(feZoneCentre(anchor, snapped), systems(), anchor.id);
      const name = useGalaxyStore.getState().systemName;
      return refuseOr(blocked === null ? null : feZoneRefusal(blocked, (s) => name(s.id)), () => {
        const zone = anchor.fe_zone ?? newFeZone(snapped.direction, snapped.distance);
        return placeFeZone(anchor.id, { ...zone, ...snapped, preferred: true });
      });
    },

    async moveFeZone(id, direction, distance) {
      const zone = systems().get(id)?.fe_zone;
      if (!zone) return false;
      return get().setFeZone(id, { ...zone, direction, distance, preferred: true });
    },

    async promptFeZoneFit() {
      let candidates: number;
      try {
        candidates = await ipc.feZoneCandidateCount();
      } catch (e) {
        useFileSessionStore.getState().setError(ipc.errorMessage(e));
        return;
      }
      let automatic = 0;
      for (const system of systems().values()) {
        if (system.fe_zone !== null && !system.fe_zone.preferred) automatic += 1;
      }
      set({ feZoneFitPrompt: { candidates, automatic } });
    },

    cancelFeZoneFit() {
      if (get().feZoneFitPrompt) set({ feZoneFitPrompt: null });
    },

    async fitFeZones(count) {
      set({ feZoneFitPrompt: null });
      const fitted = await runEdit(async () => {
        const entries = await ipc.feZoneFit(count);
        if (entries.length === 0) {
          useFileSessionStore.getState().setError(NOTHING_TO_FIT);
          return null;
        }
        return ipc.applyOp({
          type: "Batch",
          description: RECOMPUTE_FE_ZONES,
          ops: [{ type: "SetFeZones", entries }],
        });
      });
      if (fitted !== null) useMapChromeStore.getState().setLayerQuietly("feZones", true);
    },

    linkToFeZone(anchor, system) {
      return get().linkToFeZoneAll(anchor, [system]);
    },

    async linkToFeZoneAll(anchor, ids) {
      const a = systems().get(anchor);
      if (!a) return false;
      const linkable: number[] = [];
      let refusal: string | null = null;
      for (const id of [...new Set(ids)].sort((x, y) => x - y)) {
        const s = systems().get(id);
        if (!s) continue;
        const why = linkRefusal(a, s, systemName);
        if (why === null) linkable.push(id);
        else refusal ??= why;
      }
      if (linkable.length === 0) {
        if (refusal !== null) useFileSessionStore.getState().setError(refusal);
        return false;
      }
      const linked = [...linkedTo(a, systems()).map((l) => l.id), ...linkable];
      return setFeLinks(anchor, linked);
    },

    async unlinkFromFeZone(anchor, system) {
      const [a, s] = [systems().get(anchor), systems().get(system)];
      if (!a || !s) return false;
      return refuseOr(unlinkRefusal(a, s, systemName), () => {
        const linked = linkedTo(a, systems())
          .map((l) => l.id)
          .filter((id) => id !== system);
        return setFeLinks(anchor, linked);
      });
    },

    async resetFeLinks(anchor) {
      if (!systems().has(anchor)) return false;
      return setFeLinks(anchor, []);
    },

    async dropDanglingFeLinks(system) {
      const s = systems().get(system);
      if (!s) return false;
      const taken = new Set(linkedAnchors(s, systems()).map((a) => a.fe_link.id));
      const to = s.fe_link.to.filter((id) => taken.has(id));
      if (to.length === s.fe_link.to.length) return true;
      return get().applyOp({
        type: "SetFeLinkFlags",
        entries: [[system, { ...s.fe_link, to }]],
      });
    },
  };
}

/** A system's name for a refusal, as the status bar shows it. */
function systemName(s: SystemNode): string {
  return useGalaxyStore.getState().systemName(s.id);
}
