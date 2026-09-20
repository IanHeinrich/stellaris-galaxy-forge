import { vi } from "vitest";

/**
 * Stands in for `@tauri-apps/plugin-dialog`, which has no module of its own to mock:
 * a test passes this to `vi.mock("@tauri-apps/plugin-dialog", () => import(...))`.
 */
export const open = vi.fn();
export const save = vi.fn();
export const confirm = vi.fn();
