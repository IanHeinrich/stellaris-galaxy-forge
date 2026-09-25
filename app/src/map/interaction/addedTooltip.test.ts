import { beforeEach, describe, expect, it } from "vitest";
import { name, systemNode } from "../../test/builders";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { AddedTooltip } from "./addedTooltip";

beforeEach(() => {
  useGalaxyStore.getState().clear();
  useMapChromeStore.setState({ ...useMapChromeStore.getInitialState() });
  useGalaxyStore.getState().applyDelta({
    systems: [
      systemNode({ id: 6, name: name("Dorellion"), added: true }),
      systemNode({ id: 7, name: name("Nekkar") }),
    ],
  });
});

describe("the tooltip on an added system's star", () => {
  it("says the system was added this session while the pointer is on its star", () => {
    new AddedTooltip().update(6, 120, 80);
    expect(useMapChromeStore.getState().tooltip).toEqual({
      x: 120,
      y: 80,
      title: "Dorellion #6",
      lines: ["Added this session"],
    });
  });

  it("goes when the pointer moves to a system the file already held, or off the stars", () => {
    const tip = new AddedTooltip();
    tip.update(6, 120, 80);
    tip.update(7, 150, 90);
    expect(useMapChromeStore.getState().tooltip).toBeNull();
    tip.update(6, 120, 80);
    tip.drop();
    expect(useMapChromeStore.getState().tooltip).toBeNull();
  });

  it("leaves another layer's tooltip alone", () => {
    const tip = new AddedTooltip();
    tip.update(6, 120, 80);
    const other = { x: 0, y: 0, title: "Warning", lines: [] };
    useMapChromeStore.getState().showTooltip(other);
    tip.update(null, 0, 0);
    expect(useMapChromeStore.getState().tooltip).toBe(other);
  });
});
