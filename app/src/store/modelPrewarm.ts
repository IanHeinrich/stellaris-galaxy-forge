/**
 * Bakes the models a save's megastructures, starbases, habitats and ring world segments are drawn
 * from in the background once the save and the game data are both in, so a system view shows them
 * when it opens instead of seconds later. The keys are chosen as the system view chooses them.
 */
import * as ipc from "../api/ipc";
import { modelKeysOf } from "../lib/details/structures";
import { getTexture, onTextures, requestTextures } from "../lib/visual/textures";
import { useFileSessionStore } from "./fileSessionStore";
import { useGameDataStore } from "./gameDataStore";

/** How long after both are in the first models are asked for: the galaxy map's own come first. */
export const PREWARM_DELAY_MS = 1500;
/** How many models are asked for at once, and the pause after each batch settles. */
export const PREWARM_BATCH = 6;
export const PREWARM_GAP_MS = 100;

/** What was last warmed, so a store change that leaves both as they were starts nothing. */
let warmed: string | null = null;
/** Bumped by each start, so the run it replaced stops at its next step. */
let run = 0;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Resolves once every one of `keys` has landed or failed, or the run is replaced. */
function settled(keys: readonly string[], mine: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => mine !== run || keys.every((key) => getTexture(key) !== undefined);
    if (done()) return resolve();
    const stop = onTextures(() => {
      if (!done()) return;
      stop();
      resolve();
    });
  });
}

/** The open save and the loaded game data as one name, or null while either is missing. */
function subject(): string | null {
  const session = useFileSessionStore.getState();
  const data = useGameDataStore.getState();
  if (session.status !== "ready" || session.kind !== "save" || data.status !== "ready") return null;
  return `${session.path}\u0000${data.version}`;
}

async function warm(mine: number): Promise<void> {
  await pause(PREWARM_DELAY_MS);
  if (mine !== run) return;
  const uses = await ipc.getModelUses().catch(() => []);
  if (mine !== run) return;
  const keys = modelKeysOf(uses, useGameDataStore.getState());
  for (let i = 0; i < keys.length && mine === run; i += PREWARM_BATCH) {
    const batch = keys.slice(i, i + PREWARM_BATCH);
    requestTextures(batch);
    await settled(batch, mine);
    await pause(PREWARM_GAP_MS);
  }
}

function follow(): void {
  const now = subject();
  if (now === warmed) return;
  warmed = now;
  run++;
  if (now !== null) void warm(run);
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
