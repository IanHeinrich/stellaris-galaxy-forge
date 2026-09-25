import { vi } from "vitest";

/** Resolves to a spy unsubscribe; a test that drives progress captures the handler. */
export const onProgress = vi.fn(async () => () => undefined);

/** The same shape: a test that drives a rebuild captures the handler. */
export const onGameDataChanged = vi.fn(async () => () => undefined);

/** The same shape: a test that drives a download captures the handler. */
export const onUpdateProgress = vi.fn(async () => () => undefined);
