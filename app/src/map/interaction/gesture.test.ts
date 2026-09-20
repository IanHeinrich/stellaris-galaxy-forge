import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));

import { useFileSessionStore } from "../../store/fileSessionStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { GestureReporter } from "./gesture";

const gesture = () => useMapChromeStore.getState().gesture;

beforeEach(() => {
  useMapChromeStore.setState({ ...useMapChromeStore.getInitialState() });
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
});

describe("the gesture the status bar reports", () => {
  it("names the lane under the pointer, and a lane drag that outlives it", () => {
    const reporter = new GestureReporter();
    expect(gesture()).toBeNull();

    reporter.hover(true);
    expect(gesture()).toBe("lane");

    reporter.connect();
    reporter.hover(false);
    expect(gesture()).toBe("connecting");

    reporter.endConnect();
    expect(gesture()).toBeNull();
    reporter.dispose();
  });

  it("a document opened mid-drag ends it, so the next pointer move reports nothing", () => {
    const reporter = new GestureReporter();
    reporter.connect();
    expect(gesture()).toBe("connecting");

    useFileSessionStore.setState({ status: "loading" });
    expect(gesture()).toBeNull();

    reporter.hover(false);
    expect(gesture()).toBeNull();
    reporter.hover(true);
    expect(gesture()).toBe("lane");
    reporter.dispose();
  });
});
