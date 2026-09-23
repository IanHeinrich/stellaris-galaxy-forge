/** The notes the app raises on the open document itself; `bindStores` calls them as it changes. */
import * as ipc from "../api/ipc";
import {
  duplicateNameNote,
  exceedsGalaxySize,
  galaxySizeNote,
  initializerLimitNotes,
  reservedSpawnsNote,
  type AppIssue,
} from "../lib/issues";
import { reservedSeatIds, scenarioHeaderName } from "../lib/paint";
import { isUnder } from "../lib/paths";
import { getPaintLayer, useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";
import { issuesDocument, useIssuesStore } from "./issuesStore";
import { paintScenariosDir, usePaintModStore } from "./paintModStore";

/**
 * Notes every other file in the Paint a Galaxy mod's scenarios folder whose header lists the
 * open scenario's name, since the game shows one size per name. Nothing for a file elsewhere,
 * and a folder that cannot be read leaves no note.
 */
export async function noteDuplicateNames(): Promise<void> {
  const mine = issuesDocument();
  const { kind, path } = useFileSessionStore.getState();
  const dir = paintScenariosDir();
  const name = scenarioHeaderName(useGalaxyStore.getState().header);
  let notes: AppIssue[] = [];
  if (kind === "scenario" && path !== null && dir !== null && isUnder(path, dir) && name !== null) {
    const siblings = await ipc.siblingScenarioNames(path).catch(() => []);
    if (mine !== issuesDocument() || useFileSessionStore.getState().path !== path) return;
    notes = siblings
      .filter(([, other]) => other === name)
      .map(([file]) => duplicateNameNote(name, file));
  }
  useIssuesStore.getState().setNotes("scenario_name_duplicate", notes);
}

/**
 * Notes the reserved seats of a scenario on the Paint a Galaxy layer once the launcher has
 * answered and its playset does not load the Reserved Spawns submod, whose traits those seats
 * need. Nothing until the launcher answers, and nothing for a Sol seat, which needs no trait.
 */
export function noteReservedSpawns(): void {
  const { known, paintMod } = usePaintModStore.getState();
  let notes: AppIssue[] = [];
  if (known && paintMod?.reserved_spawns !== true && getPaintLayer()) {
    const seats = reservedSeatIds(useGalaxyStore.getState().systems.values());
    if (seats.length > 0) notes = [reservedSpawnsNote(seats)];
  }
  useIssuesStore.getState().setNotes("reserved_spawns_missing", notes);
}

/**
 * Notes a scenario with far more systems than the largest galaxy size the loaded game data
 * defines. Nothing for a save, and nothing without game data or a size to compare against.
 */
export function noteGalaxySize(): void {
  const { status, summary } = useGameDataStore.getState();
  const largest = status === "ready" ? (summary?.largest_galaxy ?? null) : null;
  let notes: AppIssue[] = [];
  if (largest !== null && useFileSessionStore.getState().kind === "scenario") {
    const systems = useGalaxyStore.getState().systems.size;
    if (exceedsGalaxySize(systems, largest)) notes = [galaxySizeNote(systems, largest)];
  }
  useIssuesStore.getState().setNotes("galaxy_size_exceeded", notes);
}

/**
 * Notes each initializer a scenario gives to more systems than the game's `max_instances`
 * allows. Nothing for a save, and nothing until the initializers are read.
 */
export function noteInitializerLimits(): void {
  const initializers = useGameDataStore.getState().initializers;
  let notes: AppIssue[] = [];
  if (initializers !== null && useFileSessionStore.getState().kind === "scenario") {
    const limits = new Map(
      initializers.flatMap((i): Array<[string, number]> =>
        i.max_instances === null ? [] : [[i.name, i.max_instances]],
      ),
    );
    notes = initializerLimitNotes(useGalaxyStore.getState().systems.values(), limits);
  }
  useIssuesStore.getState().setNotes("initializer_over_limit", notes);
}
