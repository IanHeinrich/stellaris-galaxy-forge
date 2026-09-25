import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");

import { useGalaxyStore } from "../../store/galaxyStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { placedNode } from "../../test/builders";
import { Camera } from "../Camera";
import { FeZoneDrag } from "./feZoneDrag";

const ANCHOR = 1;

function camera(): Camera {
  const cam = new Camera();
  cam.setViewport(800, 600);
  return cam;
}

beforeEach(() => {
  useMapChromeStore.setState({ ...useMapChromeStore.getInitialState() });
  useGalaxyStore.setState({ systems: new Map([[ANCHOR, placedNode(ANCHOR, 0, 0)]]) });
});

describe("dragging a fallen empire zone", () => {
  it("takes its readout down when the anchor goes during the drag", () => {
    const drag = new FeZoneDrag(camera(), { setFeZonePreview: () => undefined });
    drag.move(ANCHOR, 150, 0);
    expect(useMapChromeStore.getState().tooltip).not.toBeNull();

    useGalaxyStore.setState({ systems: new Map() });
    drag.move(ANCHOR, 160, 0);
    expect(useMapChromeStore.getState().tooltip).toBeNull();
  });
});
