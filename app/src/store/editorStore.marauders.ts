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
import { refuseOr, systems } from "./editorEdits";
import type { EditorState } from "./editorStore";
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

/** The next free clan in the galaxy as it stands, or null having said all three are placed. */
function freeClan(): number | null {
  const clan = nextFreeClan(systems());
  if (clan === null) useFileSessionStore.getState().setError(ALL_CLANS_PLACED);
  return clan;
}

export function marauderActions(
  _set: StoreApi<EditorState>["setState"],
  get: StoreApi<EditorState>["getState"],
): MarauderActions {
  return {
    async addMarauderClanAt(point) {
      if (freeClan() === null) return false;
      let home = -1;
      const added = await get().applyOp(() => {
        const clan = freeClan();
        if (clan === null) return null;
        home = nextSystemId(systems().values());
        const ops = [
          addSystem(home, point, homeInitializer(clan)),
          ...baseOps(home, point, clan, BASE_SITES, home + 1),
        ];
        return { type: "Batch", description: `Added marauder clan ${clan}`, ops };
      });
      if (!added) return false;
      useMapChromeStore.getState().setLayerQuietly("marauders", true);
      await get().select(home);
      return true;
    },

    async makeMarauderClan(home, bases) {
      if (freeClan() === null) return false;
      const lanes = systems().get(home)?.lanes ?? [];
      const linked = bases.every((base) => lanes.some((lane) => lane.to === base));
      const applied = await refuseOr(linked ? null : BASES_NEED_LANES, () =>
        get().applyOp(() => {
          const clan = freeClan();
          if (clan === null) return null;
          const [second, third] = [...bases].sort((a, b) => a - b);
          return {
            type: "SetInitializers",
            entries: [
              { id: home, initializer: homeInitializer(clan) },
              { id: second, initializer: baseInitializer(clan, 2) },
              { id: third, initializer: baseInitializer(clan, 3) },
            ],
          };
        }),
      );
      if (applied) useMapChromeStore.getState().setLayerQuietly("marauders", true);
      return applied;
    },

    async removeMarauderClan(clan) {
      if (clanSystems(clan, systems()).length === 0) return false;
      return get().applyOp(() => {
        const entries = clanSystems(clan, systems()).map((id) => ({ id, initializer: null }));
        return entries.length === 0 ? null : { type: "SetInitializers", entries };
      });
    },

    async renumberMarauderClan(home, to) {
      const system = systems().get(home);
      if (!system?.marauder || !("home" in system.marauder)) return false;
      const taken = (clanHomes(systems()).get(to) ?? []).some((id) => id !== home);
      return refuseOr(taken ? clanInUse(to) : null, () =>
        get().applyOp(() => {
          const now = systems().get(home);
          if (!now) return null;
          const entries = [
            { id: home, initializer: homeInitializer(to) },
            ...basesBeside(now, systems()).map((base) => ({
              id: base.id,
              initializer: baseInitializer(to, baseSite(base)),
            })),
          ];
          return { type: "SetInitializers", entries };
        }),
      );
    },

    async addMarauderBases(home) {
      const system = systems().get(home);
      if (!system?.marauder || !("home" in system.marauder)) return false;
      if (missingBaseSites(system, systems()).length === 0) return true;
      let complete = false;
      const added = await get().applyOp(() => {
        const now = systems().get(home);
        if (!now?.marauder || !("home" in now.marauder)) return null;
        const clan = now.marauder.home;
        const sites = missingBaseSites(now, systems());
        complete = sites.length === 0;
        if (complete) return null;
        return {
          type: "Batch",
          description: `Added outposts for marauder clan ${clan}`,
          ops: baseOps(home, now, clan, sites, nextSystemId(systems().values())),
        };
      });
      return added || complete;
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
