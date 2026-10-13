import { renderToStaticMarkup } from "react-dom/server";
import { expect, vi } from "vitest";
import type { BodySpawn } from "../../generated/BodySpawn";
import type { FleetSummary } from "../../generated/FleetSummary";
import type { InitializerView } from "../../generated/InitializerView";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { SystemNode } from "../../generated/SystemNode";
import type { SystemDetails } from "../../generated/SystemDetails";
import { DETAILS_DEBOUNCE_MS } from "../../store/batching";
import { useDetailsStore } from "../../store/detailsStore";
import { useEditorStore } from "../../store/editorStore";
import { useEntityStore } from "../../store/entityStore";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useInspectorStore, type Entry } from "../../store/inspectorStore";
import { usePlanetDataStore } from "../../store/planetDataStore";
import { useScriptsStore } from "../../store/scriptsStore";
import { armSession, resetStores as resetEveryStore } from "../../store/storeFixture";
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
import { PlanetView } from "./entity/PlanetView";
import { RolledMark } from "./states";
import { SystemView } from "./system/SystemView";
import { mockedIpc } from "../../test/ipc";
import { bodySpawn } from "../../test/spawn";

/** The system every test opens: Alpha Centauri, four lanes and the `basic_init_01` initializer. */
export const SYSTEM = 1;

/** What the game data says `basic_init_01` spawns, so the initializer list has something to show. */
const INITIALIZER: InitializerView = initializerView({
  name: "basic_init_01",
  source: "01_planet_classes.txt",
  class: "sc_g",
  usage: "misc_system_init",
  planets: [initPlanetView({ name: "Kepler", class: "pc_continental", size: [16, 16] })],
  planet_count: 1,
});

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
  resetEveryStore();
  useEntityStore.getState().clear();
  useScriptsStore.getState().clear();
  usePlanetDataStore.getState().clear();
  armSession();
  // A test lands the special systems it needs itself, and no answer overwrites them.
  mockedIpc.getSpecialSystems.mockReset();
  useGameDataStore.setState({ status: "ready", initializers: [INITIALIZER] });
  mockedIpc.openAsScenario.mockResolvedValue(SCENARIO_RESULT);
  mockedIpc.getSystem.mockImplementation(async (id) => detailOf(id));
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
  mockedIpc.getSystemDetails.mockResolvedValue([record]);
  useDetailsStore.getState().request([record.id]);
  await vi.advanceTimersByTimeAsync(DETAILS_DEBOUNCE_MS);
}

export const overview = () => renderToStaticMarkup(<SystemView id={SYSTEM} />);

/**
 * Every section the overview opened with, in order, as their headers read with the marks inside
 * them left out.
 */
export function sections(html: string): string[] {
  return [
    ...html.matchAll(
      /class="ins-sec-title(?: muted)?">(.*?)<\/span>(?=<span class="(?:chip|ins-sec-aside)|<\/button>)/g,
    ),
  ].map((m) => m[1].replace(/<[^>]*>/g, ""));
}

/** The overview of body `id`'s page, drilled onto from its system under `label`. */
export function page(id: number, label: string): string {
  const entry: Entry = { ref: { kind: "body", system: SYSTEM, id }, label };
  useInspectorStore.setState({ tab: "overview" });
  return renderToStaticMarkup(<PlanetView entry={entry} />);
}

/** The value of the row labelled `label`, and what follows it up to the next row. */
export function row(html: string, label: string): string {
  const start = html.indexOf(`<span class="k">${label}</span>`);
  expect(start, `a ${label} row`).toBeGreaterThan(-1);
  const rest = html.slice(start + label.length + 22);
  const next = rest.indexOf('<span class="k">');
  return next === -1 ? rest : rest.slice(0, next);
}

/** The edit row labelled `label`, up to the next edit row. */
export function editRow(html: string, label: string): string {
  const start = html.indexOf(`<span class="edit-label">${label}</span>`);
  expect(start, `a ${label} row`).toBeGreaterThan(-1);
  const rest = html.slice(start + 1);
  const next = rest.indexOf('<span class="edit-label">');
  return next === -1 ? rest : rest.slice(0, next);
}

/** The die that marks a rolled value, as it renders. */
export const DIE = renderToStaticMarkup(<RolledMark />);

/** A value in the rolled look, as it renders. */
export function rolled(text: string): string {
  return `<span class="ins-st-rolled">${DIE}${text}</span>`;
}

/** Changes system `id` in the galaxy store, as an edit or a reread would. */
export function patchSystem(id: number, patch: Partial<SystemNode>): void {
  const systems = new Map(useGalaxyStore.getState().systems);
  const system = systems.get(id);
  if (system === undefined) throw new Error(`the fixture has no system ${id}`);
  systems.set(id, { ...system, ...patch });
  useGalaxyStore.setState({ systems });
}

/** Names system `SYSTEM` as the map does. */
export function nameSystem(key: string): void {
  patchSystem(SYSTEM, { name: { ...name(key), literal: true } });
}

/** A planet drawn from the classes that fit its orbit, named by the game. */
export function randomPlanet(id: number, over: Partial<BodySpawn> = {}): PlanetSummary {
  return planet(id, "", {
    class: "random",
    drawn: true,
    size: null,
    ring: null,
    spawn: bodySpawn({
      class: {
        state: "rolled",
        pool: {
          kind: "random",
          draw: "random",
          at_orbit: [
            { class: "pc_toxic", weight: 1 },
            { class: "pc_barren", weight: 3 },
          ],
        },
      },
      ...over,
    }),
  });
}
