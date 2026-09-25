import type { StoreApi } from "zustand";
import * as ipc from "../api/ipc";
import type { KindCount } from "../generated/KindCount";
import type { ScenarioBypasses } from "../generated/ScenarioBypasses";
import type { ScenarioOwners } from "../generated/ScenarioOwners";
import type { SpecialSystem } from "../generated/SpecialSystem";
import { useDetailsStore } from "./detailsStore";
import type { GameDataState } from "./gameDataStore";
import { countryNames, nameKeys } from "./gameDataStore.names";
import { useGalaxyStore } from "./galaxyStore";
import { useScriptsStore } from "./scriptsStore";

/** What the game data says of the open document: nothing while none is open. */
export const NO_DOCUMENT = {
  special: new Map<number, SpecialSystem>(),
  specialPending: false,
  counts: [] as KindCount[],
  specialWithGameData: false,
  scenarioOwners: null as ScenarioOwners | null,
  scenarioOwnersPending: false,
  scenarioBypasses: null as ScenarioBypasses | null,
};

type DocumentActions = Pick<
  GameDataState,
  "refreshSpecial" | "refreshScenarioOwners" | "onSaveOpened" | "onSaveClosed"
>;

/** The open document's classification: its special systems, and a scenario's scripted owners. */
export function documentActions(
  set: StoreApi<GameDataState>["setState"],
  get: StoreApi<GameDataState>["getState"],
): DocumentActions {
  return {
    async refreshSpecial(alive) {
      if (useGalaxyStore.getState().galaxy === null) return;
      set({ specialPending: true });
      try {
        const result = await ipc.getSpecialSystems();
        if (alive?.() === false) {
          set({ specialPending: false });
          return;
        }
        set({
          special: new Map(result.systems.map((s) => [s.id, s])),
          counts: result.counts,
          specialWithGameData: result.with_game_data,
          specialPending: false,
        });
      } catch (e) {
        set({ error: ipc.errorMessage(e), specialPending: false });
      }
    },

    async refreshScenarioOwners(alive) {
      if (useGalaxyStore.getState().galaxy === null) return;
      set({ scenarioOwnersPending: true });
      try {
        const owners = await ipc.getScenarioOwners();
        if (alive?.() === false) {
          set({ scenarioOwnersPending: false });
          return;
        }
        set({ scenarioOwners: owners, scenarioOwnersPending: false });
        const galaxy = useGalaxyStore.getState();
        // A document with no scripted owners, before or now, leaves the galaxy as it found it.
        if (owners !== null || galaxy.scriptedOwners.size > 0) {
          galaxy.setScriptedOwners(
            ownerMap(owners),
            owners?.territories.map((t) => t.country) ?? [],
          );
        }
        const bypasses = await ipc.getScenarioBypasses();
        if (alive?.() === false) return;
        set({ scenarioBypasses: bypasses ?? null });
      } catch (e) {
        set({ error: ipc.errorMessage(e), scenarioOwnersPending: false });
      }
    },

    async onSaveOpened() {
      useDetailsStore.getState().clear();
      useScriptsStore.getState().clear();
      void get().refreshSpecial();
      const owners = get().refreshScenarioOwners();
      if (get().status === "ready") {
        void get().fetchNames(nameKeys());
        void get().resolveNames(countryNames());
      }
      await owners.catch(() => undefined);
    },

    onSaveClosed() {
      useDetailsStore.getState().clear();
      useScriptsStore.getState().clear();
      set({ ...NO_DOCUMENT });
    },
  };
}

/** Each scenario system mapped to the territory country that owns it; empty without scripted owners. */
function ownerMap(owners: ScenarioOwners | null): Map<number, number> {
  return new Map(owners?.owners.map((o) => [o.system, o.territory]) ?? []);
}
