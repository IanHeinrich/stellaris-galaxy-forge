import { vi } from "vitest";

/** `vi.waitFor` polling every millisecond: its default 50 ms poll made most of the slow tests slow. */
export function until<T>(check: () => T | Promise<T>): Promise<T> {
  return vi.waitFor(check, { interval: 1 });
}
