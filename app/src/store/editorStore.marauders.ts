import type { StoreApi } from "zustand";
import type { Op } from "../generated/Op";
import {
  ALL_CLANS_PLACED,
  BASE_SITES,
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
  type BaseSite,
} from "../lib/marauder";
import { nextSystemId } from "../lib/paint";
import { refuseOr, systems, type EditorState } from "./editorStore";
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
      const home = nextSystemId(systems().values());
      const ops = [
        addSystem(home, point, homeInitializer(clan)),
        ...baseOps(home, point, clan, BASE_SITES, home + 1),
      ];
      const op: Op = { type: "Batch", description: `Added marauder clan ${clan}`, ops };
      if (!(await get().applyOp(op))) return false;
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
      const sites = missingBaseSites(system, systems());
      if (sites.length === 0) return true;
      const ops = baseOps(home, system, clan, sites, nextSystemId(systems().values()));
      return get().applyOp({
        type: "Batch",
        description: `Added raid bases for marauder clan ${clan}`,
        ops,
      });
    },
  };
}

function addSystem(id: number, point: { x: number; y: number }, initializer: string): Op {
  return {
    type: "AddSystem",
    id,
    x: point.x,
    y: point.y,
    name: null,
    initializer,
    spawn_weight: null,
    spawn_script: null,
  };
}

/** The bases of `sites` placed about `home`, numbered from `firstId`, and the lanes from the home to them. */
function baseOps(
  home: number,
  at: { x: number; y: number },
  clan: number,
  sites: readonly BaseSite[],
  firstId: number,
): Op[] {
  const bases = placeBases(at, sites, systems().values());
  const ops: Op[] = bases.map((base, i) =>
    addSystem(firstId + i, base, baseInitializer(clan, base.site)),
  );
  ops.push({ type: "AddLanes", from: home, to: bases.map((_, i) => [firstId + i, false]) });
  return ops;
}
