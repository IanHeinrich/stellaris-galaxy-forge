/**
 * Bakes the models a save's megastructures, starbases, habitats and ring world segments are drawn
 * from in the background once the save and the game data are both in, so a system view shows them
 * when it opens instead of seconds later. The keys are chosen as the system view chooses them.
 */
import * as ipc from "../api/ipc";
import { modelKeysOf, type ModelSources } from "../lib/details/structures";
import { getTexture, onTextures, requestTextures, textureLoading } from "../lib/visual/textures";
import { useFileSessionStore } from "./fileSessionStore";
import { useGameDataStore } from "./gameDataStore";

/** How long after both are in the first models are asked for: the galaxy map's own come first. */
export const PREWARM_DELAY_MS = 1500;
/** How many models are asked for at once, and the pause after each batch settles. */
export const PREWARM_BATCH = 6;
export const PREWARM_GAP_MS = 100;
/** The longest a batch is waited on, so a run never stalls on an answer that does not come. */
export const PREWARM_BATCH_LIMIT_MS = 120_000;

/** The open save and the game data whose registries its keys are chosen by. */
interface Subject {
  readonly path: string | null;
  readonly version: number;
  readonly sources: ModelSources;
}

/** What was last warmed, so a store change that leaves both as they were starts nothing. */
let warmed: Subject | null = null;
/** Bumped by each start, so the run it replaced stops at its next step. */
let run = 0;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Resolves once every one of `keys` has landed, failed or been dropped by a cache clear, the run
 * is replaced, or the batch has waited `PREWARM_BATCH_LIMIT_MS`.
 */
function settled(keys: readonly string[], mine: number): Promise<void> {
  const done = () =>
    mine !== run || keys.every((key) => getTexture(key) !== undefined || !textureLoading(key));
  if (done()) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      stop();
      clearTimeout(limit);
      resolve();
    };
    const stop = onTextures(() => {
      if (done()) finish();
    });
    const limit = setTimeout(finish, PREWARM_BATCH_LIMIT_MS);
  });
}

/**
 * The open save and the loaded game data, or null while either is missing or the game data's
 * registries have not landed.
 */
function subject(): Subject | null {
  const session = useFileSessionStore.getState();
  const data = useGameDataStore.getState();
  if (session.status !== "ready" || session.kind !== "save" || data.status !== "ready") return null;
  const { megastructureTypes, starbaseLevels, planetClasses } = data;
  if (planetClasses.size === 0) return null;
  return {
    path: session.path,
    version: data.version,
    sources: { megastructureTypes, starbaseLevels, planetClasses },
  };
}

function sameSubject(a: Subject | null, b: Subject | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.path === b.path &&
    a.version === b.version &&
    a.sources.megastructureTypes === b.sources.megastructureTypes &&
    a.sources.starbaseLevels === b.sources.starbaseLevels &&
    a.sources.planetClasses === b.sources.planetClasses
  );
}

async function warm(mine: number, sources: ModelSources): Promise<void> {
  await pause(PREWARM_DELAY_MS);
  if (mine !== run) return;
  const uses = await ipc.getModelUses().catch(() => []);
  if (mine !== run) return;
  const keys = modelKeysOf(uses, sources);
  for (let i = 0; i < keys.length && mine === run; i += PREWARM_BATCH) {
    const batch = keys.slice(i, i + PREWARM_BATCH);
    requestTextures(batch);
    await settled(batch, mine);
    await pause(PREWARM_GAP_MS);
  }
}

function follow(): void {
  const now = subject();
  if (sameSubject(now, warmed)) return;
  warmed = now;
  run++;
  if (now !== null) void warm(run, now.sources);
}

/** Warms the models of each save opened, once per save and game data. */
export function followModelPrewarm(): void {
  useFileSessionStore.subscribe(follow);
  useGameDataStore.subscribe(follow);
  follow();
}

/** Forgets what was warmed and stops a run, for a test that starts afresh. */
export function resetModelPrewarm(): void {
  warmed = null;
  run++;
}
