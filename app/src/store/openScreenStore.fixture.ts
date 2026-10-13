import type { ScenarioListing } from "../generated/ScenarioListing";
import type { ScenarioListings } from "../generated/ScenarioListings";
import { openSections, type Section } from "../lib/openRows";
import { TERRAN, VOID, campaignSave, modScenario } from "../test/builders";
import { mockedIpc } from "../test/ipc";
import { useOpenScreenStore } from "./openScreenStore";
import { useRecentsStore, type RecentDoc } from "./recentsStore";
import { resetStores } from "./storeFixture";

export const screen = () => useOpenScreenStore.getState();

/** What `list_scenarios` resolves to: the files, and what the mod descriptors could not say. */
export function listed(scenarios: ScenarioListing[], diagnostics: string[] = []): ScenarioListings {
  return { scenarios, diagnostics };
}

export const RECENT: RecentDoc = {
  kind: "save",
  path: "C:/saves/terran/2206.11.16.sav",
  title: "Terran Federation",
  subtitle: "Terran Federation · 2206.11.16 · v4.4.6",
  openedAt: 5,
};

/** The sections as the screen shows them for the current state. */
export function sections(): Section[] {
  return openSections(screen(), useRecentsStore.getState().recents);
}

export function section(id: string): Section {
  return sections().find((s) => s.id === id)!;
}

export function rowKeys(id: string): string[] {
  return (
    sections()
      .find((s) => s.id === id)
      ?.rows.map((r) => r.key) ?? []
  );
}

/** Fresh stores and the lists a plain install answers: two campaigns, one save, one mod scenario. */
export function armScreen(): void {
  resetStores();
  mockedIpc.listCampaigns.mockResolvedValue([VOID, TERRAN]);
  mockedIpc.listCampaignSaves.mockResolvedValue([campaignSave()]);
  mockedIpc.listScenarios.mockResolvedValue(listed([modScenario()]));
  mockedIpc.missingPaths.mockResolvedValue([]);
  mockedIpc.closeDocument.mockResolvedValue();
  mockedIpc.warmDetails.mockResolvedValue([]);
  mockedIpc.getSpecialSystems.mockResolvedValue({ systems: [], counts: [], with_game_data: false });
}
