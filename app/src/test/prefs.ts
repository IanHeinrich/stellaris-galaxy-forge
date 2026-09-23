import { vi } from "vitest";

/** Empties `stored` and makes it the `localStorage` the preferences read and write. */
export function stubPrefs(stored = new Map<string, string>()): Map<string, string> {
  stored.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
  });
  return stored;
}
