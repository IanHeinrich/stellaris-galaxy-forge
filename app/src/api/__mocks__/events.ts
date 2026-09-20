import { vi } from "vitest";

export const PROGRESS_EVENT = "sgf://progress";

/** Resolves to a spy unsubscribe; a test that drives progress captures the handler. */
export const onProgress = vi.fn(async () => () => undefined);

export const GAME_DATA_CHANGED_EVENT = "sgf://gamedata-changed";

/** The same shape: a test that drives a rebuild captures the handler. */
export const onGameDataChanged = vi.fn(async () => () => undefined);

export const UPDATE_PROGRESS_EVENT = "sgf://update-progress";

/** The same shape: a test that drives a download captures the handler. */
export const onUpdateProgress = vi.fn(async () => () => undefined);
