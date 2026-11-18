import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
// The texture cache cannot fill in a static render, so each picture shows the key it asks for first.
vi.mock("../useTextureUrl", () => ({
  useTextureUrl: (keys: readonly string[]) => `tex:${keys[0]}`,
}));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import {
  OTHER_OBJECTS,
  PLACED_IN_SYSTEMS,
  READING_AMBIENT_OBJECTS,
} from "../../lib/ambientObjectAdd";
import { bindStores } from "../../store/bindStores";
import { useAmbientObjectAddStore } from "../../store/ambientObjectAdd";
import { SCENARIO_RESULT } from "../../store/fixture";
import { useGameDataStore } from "../../store/gameDataStore";
import { armSession, resetStores } from "../../store/storeFixture";
import { ambientObjectView, systemDetails } from "../../test/builders";
import { inSystem, openWith } from "../../test/session";
import { AddAmbientObjectDialog } from "./AddAmbientObjectDialog";

bindStores();

const dialog = () => renderToStaticMarkup(<AddAmbientObjectDialog />);

beforeEach(async () => {
  resetStores();
  armSession();
  await openWith(SCENARIO_RESULT);
  inSystem(systemDetails({ id: 0 }));
  useGameDataStore.setState({ status: "ready" });
  useAmbientObjectAddStore.setState({ prompt: { system: 0, x: 0, y: 112 }, last: null });
});

describe("the Add ambient object browser", () => {
  it("waits for the ambient objects while they are read", () => {
    expect(dialog()).toContain(READING_AMBIENT_OBJECTS);
  });

  it("reads the spot, lists the placed objects first, and previews the first with what places it", () => {
    useGameDataStore.setState({
      ambientObjects: new Map(
        [
          ambientObjectView("storm_object", {
            name: "Ion Storm",
            portrait: null,
            selectable: false,
          }),
          ambientObjectView("derelict_ship_object", {
            name: "Derelict Ship",
            description: "A ship adrift.",
            placed_by: ["scavenger_system"],
          }),
        ].map((v) => [v.key, v]),
      ),
    });
    const html = dialog();
    expect(html).toContain("Add an ambient object in");
    expect(html).toContain("At orbit 112 · 90°");
    expect(html).toContain('aria-label="Filter ambient objects"');
    const order = [PLACED_IN_SYSTEMS, "Derelict Ship", OTHER_OBJECTS, "Ion Storm"].map((text) =>
      html.indexOf(text),
    );
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain("tex:model:none:derelict_ship_object_entity");
    expect(html).toMatch(/<span class="megastructure-add-portrait"><\/span>/);
    const preview = html.slice(html.indexOf('aria-label="Selected ambient object"'));
    expect(preview).toContain("Derelict Ship");
    expect(preview).toContain("A ship adrift.");
    expect(preview).toContain("Visible by name");
    expect(preview).toContain("<code>scavenger_system</code>");
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Add<\/button>/);
  });
});
