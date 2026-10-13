import { vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));
vi.mock("react/jsx-dev-runtime", () => import("./drawn"));
