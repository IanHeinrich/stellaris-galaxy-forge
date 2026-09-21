import type { StoreApi } from "zustand";
import type { Op } from "../generated/Op";
import {
  ALL_CLANS_PLACED,
  BASES_NEED_LANES,
  baseInitializer,
  basesBeside,
  baseSite,
  clanHomes,
  clanInUse,
  clanSystems,
  homeInitializer,
  missingBaseSites,
  nextFreeClan,
  placeBases,
} from "../lib/marauder";
import { addSystem, refuseOr, systems, type EditorState } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { useMapChromeStore } from "./mapChromeStore";

type MarauderActions = Pick<
  EditorState,
  | "addMarauderClanAt"
  | "makeMarauderClan"
  | "removeMarauderClan"
  | "addMarauderBases"
  | "renumberMarauderClan"
>;

export function marauderActions(
  _set: StoreApi<EditorState>["setState"],
  get: StoreApi<EditorState>["getState"],
): MarauderActions {
  return {
    async addMarauderClanAt(point) {
      const clan = nextFreeClan(systems());
      if (clan === null) {
        useFileSessionStore.getState().setError(ALL_CLANS_PLACED);
        return false;
      }
      const home = await addSystem(point, homeInitializer(clan));
      if (home === null) return false;
      if (!(await get().addMarauderBases(home))) return false;
      useMapChromeStore.getState().showLayer("marauders");
      await get().select(home);
      return true;
    },

    async makeMarauderClan(home, bases) {
      const clan = nextFreeClan(systems());
      if (clan === null) {
        useFileSessionStore.getState().setError(ALL_CLANS_PLACED);
        return false;
      }
      const lanes = systems().get(home)?.lanes ?? [];
      const linked = bases.every((base) => lanes.some((lane) => lane.to === base));
      const applied = await refuseOr(linked ? null : BASES_NEED_LANES, () => {
        const [second, third] = [...bases].sort((a, b) => a - b);
        const op: Op = {
          type: "SetInitializers",
          entries: [
            { id: home, initializer: homeInitializer(clan) },
            { id: second, initializer: baseInitializer(clan, 2) },
            { id: third, initializer: baseInitializer(clan, 3) },
          ],
        };
        return get().applyOp(op);
      });
      if (applied) useMapChromeStore.getState().showLayer("marauders");
      return applied;
    },

    async removeMarauderClan(clan) {
      const entries = clanSystems(clan, systems()).map((id) => ({ id, initializer: null }));
      if (entries.length === 0) return false;
      return get().applyOp({ type: "SetInitializers", entries });
    },

    async renumberMarauderClan(home, to) {
      const system = systems().get(home);
      if (!system?.marauder || !("home" in system.marauder)) return false;
      const taken = (clanHomes(systems()).get(to) ?? []).some((id) => id !== home);
      return refuseOr(taken ? clanInUse(to) : null, () => {
        const entries = [
          { id: home, initializer: homeInitializer(to) },
          ...basesBeside(system, systems()).map((base) => ({
            id: base.id,
            initializer: baseInitializer(to, baseSite(base)),
          })),
        ];
        return get().applyOp({ type: "SetInitializers", entries });
      });
    },

    async addMarauderBases(home) {
      const system = systems().get(home);
      if (!system?.marauder || !("home" in system.marauder)) return false;
      const clan = system.marauder.home;
      const added: number[] = [];
      for (const site of placeBases(
        system,
        missingBaseSites(system, systems()),
        systems().values(),
      )) {
        const id = await addSystem(site, baseInitializer(clan, site.site));
        if (id === null) return false;
        added.push(id);
      }
      if (added.length === 0) return true;
      const lanes: Op = { type: "AddLanes", from: home, to: added.map((id) => [id, false]) };
      return get().applyOp(lanes);
    },
  };
}
