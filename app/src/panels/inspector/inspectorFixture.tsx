import { renderToStaticMarkup } from "react-dom/server";
import { vi } from "vitest";
import { confirm } from "@tauri-apps/plugin-dialog";
import type { FleetSummary } from "../../generated/FleetSummary";
import type { InitializerView } from "../../generated/InitializerView";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { SystemDetails } from "../../generated/SystemDetails";
import { onProgress } from "../../api/events";
import * as ipc from "../../api/ipc";
import { DETAILS_DEBOUNCE_MS } from "../../store/batching";
import { useDetailsStore } from "../../store/detailsStore";
import { useEditorStore } from "../../store/editorStore";
import { useEntityStore } from "../../store/entityStore";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useInspectorStore } from "../../store/inspectorStore";
import { useScriptsStore } from "../../store/scriptsStore";
import {
  detailOf,
  fleetSummary,
  initializerView,
  initPlanetView,
  name,
  OPEN_RESULT,
  planetSummary,
  SCENARIO_RESULT,
  systemDetails,
} from "../../store/fixture";
import { SystemView } from "./system/SystemView";

/** The system every test opens: Alpha Centauri, four lanes and the `basic_init_01` initializer. */
export const SYSTEM = 1;

/** What the game data says `basic_init_01` spawns, so the initializer list has something to show. */
export const INITIALIZER: InitializerView = initializerView({
  name: "basic_init_01",
  source: "01_planet_classes.txt",
  class: "sc_g",
  usage: "misc_system_init",
  planets: [initPlanetView({ name: "Kepler", class: "pc_continental", size: [16, 16] })],
  planet_count: 1,
});

export const mocked = {
  openSave: vi.mocked(ipc.openSave),
  openAsScenario: vi.mocked(ipc.openAsScenario),
  getSystem: vi.mocked(ipc.getSystem),
  getSystemDetails: vi.mocked(ipc.getSystemDetails),
  closeSave: vi.mocked(ipc.closeSave),
  warmDetails: vi.mocked(ipc.warmDetails),
  getSpecialSystems: vi.mocked(ipc.getSpecialSystems),
  applyOp: vi.mocked(ipc.applyOp),
  confirm: vi.mocked(confirm),
  onProgress: vi.mocked(onProgress),
};

/** A habitable world of the system under test, named by its key. */
export function planet(id: number, key: string, extra: Partial<PlanetSummary> = {}): PlanetSummary {
  return planetSummary({ id, name: name(key), name_key: key, habitable: true, size: 16, ...extra });
}

/** A fleet stationed in the system under test, with a power and a hull count worth showing. */
export function fleet(id: number, key: string, extra: Partial<FleetSummary> = {}): FleetSummary {
  return fleetSummary({
    id,
    name: name(key),
    name_key: key,
    military_power: 8019,
    ships: 15,
    ...extra,
  });
}

export function details(extra: Partial<SystemDetails> = {}): SystemDetails {
  return { ...systemDetails({ id: SYSTEM }), with_game_data: true, ...extra };
}

/** The state every test starts from: empty caches, a ready game data store, answered opens. */
export function resetStores(): void {
  useGalaxyStore.getState().clear();
  useDetailsStore.getState().clear();
  useEntityStore.getState().clear();
  useScriptsStore.getState().clear();
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
  useEditorStore.setState({ ...useEditorStore.getInitialState() });
  useInspectorStore.setState({ ...useInspectorStore.getInitialState() });
  useGameDataStore.setState({
    ...useGameDataStore.getInitialState(),
    status: "ready",
    initializers: [INITIALIZER],
  });
  mocked.onProgress.mockResolvedValue(() => undefined);
  mocked.openSave.mockResolvedValue(OPEN_RESULT);
  mocked.openAsScenario.mockResolvedValue(SCENARIO_RESULT);
  mocked.getSystem.mockImplementation(async (id) => detailOf(id));
}

/** Opens a document and selects `SYSTEM`, as the map does when the user clicks it. */
export async function open(kind: "save" | "scenario"): Promise<void> {
  const session = useFileSessionStore.getState();
  await (kind === "save"
    ? session.openSave(OPEN_RESULT.path)
    : session.openScenarioFrom(SCENARIO_RESULT.path));
  await useEditorStore.getState().select(SYSTEM);
}

/** Lands one details record, the way an answered `get_system_details` does. */
export async function land(record: SystemDetails): Promise<void> {
  mocked.getSystemDetails.mockResolvedValue([record]);
  useDetailsStore.getState().request([record.id]);
  await vi.advanceTimersByTimeAsync(DETAILS_DEBOUNCE_MS);
}

export const overview = () => renderToStaticMarkup(<SystemView id={SYSTEM} />);

/** Every section the overview opened with, in order, as their headers name them. */
export function sections(html: string): string[] {
  return [...html.matchAll(/class="ins-sec-title(?: muted)?">([^<]*)</g)].map((m) => m[1]);
}
