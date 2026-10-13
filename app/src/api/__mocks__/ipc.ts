import { vi } from "vitest";

/** The helpers that are not commands keep their real behaviour: tests assert on their messages. */
const REAL = new Set(["errorMessage", "isSgfError"]);

/**
 * Every Tauri command as a spy, so a store test says only what the calls it exercises
 * resolve to. A command a test has not armed rejects, because the backend always answers.
 */
const actual = await vi.importActual<Record<string, unknown>>("../ipc");
for (const [name, value] of Object.entries(actual)) {
  if (typeof value === "function" && !REAL.has(name)) {
    Object.defineProperty(actual, name, {
      value: vi.fn(async (): Promise<never> => {
        throw new Error(`unarmed ipc mock: ${name}`);
      }),
    });
  }
}

export * from "../ipc";
